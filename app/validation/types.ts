export type ResourceKind =
  | "Deployment"
  | "Pod"
  | "Service"
  | "Job"
  | "CronJob"
  | "Route"
  | "PersistentVolumeClaim"
  | "PersistentVolume";

export type PortInput = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
};

export type LabelInput = {
  id: number;
  key: string;
  value: string;
};

export type EnvironmentVariableInput = {
  id: number;
  name: string;
  sourceType: "value" | "secret" | "configMap";
  value: string;
  sourceName: string;
  sourceKey: string;
};

export type ContainerInput = {
  id: number;
  name: string;
  image: string;
  commandEnabled: boolean;
  command: string;
  args: string;
  environmentVariables: EnvironmentVariableInput[];
  resourcesEnabled: boolean;
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
  ports: PortInput[];
};

export type VolumeInput = {
  id: number;
  name: string;
  type: string;
  source: string;
  mountPoints: Array<{
    id: number;
    containerId: number;
    mountPath: string;
  }>;
};

export type ValidationInput = {
  kind: ResourceKind;
  name: string;
  namespace: string;
  labels: LabelInput[];
  replicas: string;
  completions: string;
  parallelism: string;
  backoffLimit: string;
  schedule: string;
  routeHost: string;
  routePath: string;
  routeServiceName: string;
  routeTargetPort: string;
  storageAccessModes: string[];
  storageClassName: string;
  storageRequest: string;
  storageCapacity: string;
  pvcVolumeName: string;
  pvSourceType: string;
  pvHostPath: string;
  pvNfsServer: string;
  pvNfsPath: string;
  pvCsiDriver: string;
  pvCsiVolumeHandle: string;
  serviceAccount: string;
  serviceAccountEnabled: boolean;
  servicePorts: PortInput[];
  containers: ContainerInput[];
  volumes: VolumeInput[];
};

export type ValidationErrors = Record<string, string>;
export type ObjectValidator = (input: ValidationInput) => ValidationErrors;
