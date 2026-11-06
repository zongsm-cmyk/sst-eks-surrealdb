import { StackContext } from "sst/constructs";
import * as cdk from "aws-cdk-lib";
import * as eks from "aws-cdk-lib/aws-eks";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export function EksStack({ stack }: StackContext) {
  // 1. Create VPC
  const vpc = new ec2.Vpc(stack, "SurrealDBVPC", {
    maxAzs: 3,
    natGateways: 1,
  });

  // 2. Create EKS Cluster
  const cluster = new eks.Cluster(stack, "SurrealDBCluster", {
    vpc,
    version: eks.KubernetesVersion.V1_28,
    defaultCapacity: 2,
    defaultCapacityInstance: ec2.InstanceType.of(
      ec2.InstanceClass.M5,
      ec2.InstanceSize.LARGE
    ),
  });

  // 3. Add Dedicated Node Groups for TiKV, PD, and TiDB
  const tikvNodeGroup = cluster.addNodegroupCapacity("TiKVNodeGroup", {
    instanceTypes: [
      ec2.InstanceType.of(ec2.InstanceClass.R5B, ec2.InstanceSize.XLARGE2),
    ],
    minSize: 3,
    maxSize: 3,
    desiredSize: 3,
    labels: {
      dedicated: "tikv",
    },
    taints: [
      {
        key: "dedicated",
        value: "tikv",
        effect: eks.TaintEffect.NO_SCHEDULE,
      },
    ],
  });

  const pdNodeGroup = cluster.addNodegroupCapacity("PDNodeGroup", {
    instanceTypes: [
      ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE),
    ],
    minSize: 3,
    maxSize: 3,
    desiredSize: 3,
    labels: {
      dedicated: "pd",
    },
    taints: [
      {
        key: "dedicated",
        value: "pd",
        effect: eks.TaintEffect.NO_SCHEDULE,
      },
    ],
  });

  const tidbNodeGroup = cluster.addNodegroupCapacity("TiDBNodeGroup", {
    instanceTypes: [
      ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE2),
    ],
    minSize: 2,
    maxSize: 2,
    desiredSize: 2,
    labels: {
      dedicated: "tidb",
    },
    taints: [
      {
        key: "dedicated",
        value: "tidb",
        effect: eks.TaintEffect.NO_SCHEDULE,
      },
    ],
  });

  // 4. Install TiDB Operator Helm Chart
  const tidbOperator = cluster.addHelmChart("TiDBOperator", {
    chart: "tidb-operator",
    repository: "https://charts.pingcap.org/",
    version: "v1.6.1",
    namespace: "tidb-admin",
    createNamespace: true,
    values: {
      operator: {
        createCRD: true,
      },
    },
  });

  // 5. Deploy TiDB Cluster Specification (PD + TiKV)
  const tidbClusterManifest = cluster.addManifest("TiDBClusterSpec", {
    apiVersion: "pingcap.com/v1alpha1",
    kind: "TidbCluster",
    metadata: {
      name: "basic",
      namespace: "tidb-cluster",
    },
    spec: {
      version: "v8.5.0",
      timezone: "UTC",
      pvReclaimPolicy: "Retain",
      pd: {
        baseImage: "pingcap/pd",
        replicas: 3,
        requests: { storage: "10Gi" },
        nodeSelector: { dedicated: "pd" },
        tolerations: [{ key: "dedicated", value: "pd", effect: "NoSchedule" }],
      },
      tikv: {
        baseImage: "pingcap/tikv",
        replicas: 3,
        requests: { storage: "100Gi" },
        nodeSelector: { dedicated: "tikv" },
        tolerations: [{ key: "dedicated", value: "tikv", effect: "NoSchedule" }],
      },
      tidb: {
        baseImage: "pingcap/tidb",
        replicas: 2,
        service: { type: "ClusterIP" },
        nodeSelector: { dedicated: "tidb" },
        tolerations: [{ key: "dedicated", value: "tidb", effect: "NoSchedule" }],
      },
    },
  });
  tidbClusterManifest.node.addDependency(tidbOperator);
  tidbClusterManifest.node.addDependency(tikvNodeGroup);
  tidbClusterManifest.node.addDependency(pdNodeGroup);
  tidbClusterManifest.node.addDependency(tidbNodeGroup);

  // 6. Deploy SurrealDB on TiKV via Official Helm Chart
  const surrealdbChart = cluster.addHelmChart("SurrealDBOnTiKV", {
    chart: "surrealdb",
    repository: "https://surrealdb.github.io/helm-charts",
    version: "0.3.7",
    namespace: "surrealdb",
    createNamespace: true,
    values: {
      image: {
        repository: "surrealdb/surrealdb",
        tag: "v2.2.2",
      },
      surrealdb: {
        auth: true,
        path: "tikv://basic-pd.tidb-cluster:2379",
      },
      service: {
        type: "LoadBalancer",
        port: 8000,
      },
    },
  });
  surrealdbChart.node.addDependency(tidbClusterManifest);

  stack.addOutputs({
    ClusterName: cluster.clusterName,
    ClusterArn: cluster.clusterArn,
  });

  return {
    vpc,
    cluster,
  };
}
