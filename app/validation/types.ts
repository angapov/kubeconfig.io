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

export type ContainerInput = {
  id: number;
  name: string;
  image: string;
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
  securityExpanded: boolean;
  serviceAccount: string;
  servicePorts: PortInput[];
  containers: ContainerInput[];
  volumes: VolumeInput[];
};

export type ValidationErrors = Record<string, string>;
export type ObjectValidator = (input: ValidationInput) => ValidationErrors;
