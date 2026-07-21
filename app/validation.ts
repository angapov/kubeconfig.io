type ResourceKind =
  | "Deployment"
  | "Pod"
  | "Service"
  | "Job"
  | "CronJob"
  | "Route"
  | "PersistentVolumeClaim"
  | "PersistentVolume";

type PortInput = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
};

type LabelInput = {
  id: number;
  key: string;
  value: string;
};

type ContainerInput = {
  id: number;
  name: string;
  image: string;
  ports: PortInput[];
};

type VolumeInput = {
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

type ValidationInput = {
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

const DNS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LABEL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
const PORT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const STORAGE_QUANTITY_PATTERN = /^\+?(?:\d+(?:\.\d+)?|\.\d+)(?:(?:[eE][+-]?\d+)|(?:[EPTGMk]i?)|m)?$/;

function validateDnsName(value: string, label: string, labelOnly = false) {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const maximum = labelOnly ? 63 : 253;
  const pattern = labelOnly ? DNS_LABEL_PATTERN : DNS_SUBDOMAIN_PATTERN;
  if (trimmed.length > maximum || !pattern.test(trimmed)) {
    return `${label} must use lowercase letters, numbers${labelOnly ? "" : ", dots"}, or hyphens and start and end with a letter or number.`;
  }
  return undefined;
}

function validatePort(value: string, label: string, required = true) {
  if (!value.trim()) return required ? `${label} is required.` : undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return `${label} must be an integer from 1 to 65535.`;
  }
  return undefined;
}

function validateNonNegativeInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!value.trim() || !Number.isInteger(parsed) || parsed < 0) {
    return `${label} must be a non-negative integer.`;
  }
  return undefined;
}

function validateStorageQuantity(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (!STORAGE_QUANTITY_PATTERN.test(trimmed) || Number.parseFloat(trimmed) <= 0) {
    return `${label} must be a positive Kubernetes quantity such as 1Gi or 500Mi.`;
  }
  return undefined;
}

function validatePortName(value: string) {
  if (!value) return undefined;
  if (value.length > 15 || !PORT_NAME_PATTERN.test(value) || !/[a-z]/.test(value)) {
    return "Port name must be 15 characters or fewer, contain a letter, and use lowercase letters, numbers, or hyphens.";
  }
  return undefined;
}

function validateLabelKey(value: string) {
  const key = value.trim();
  if (!key) return "Label key is required.";
  const slash = key.lastIndexOf("/");
  const prefix = slash >= 0 ? key.slice(0, slash) : "";
  const keyName = slash >= 0 ? key.slice(slash + 1) : key;
  if (!keyName || keyName.length > 63 || !LABEL_NAME_PATTERN.test(keyName)) {
    return "Label key name is invalid.";
  }
  if (prefix && (prefix.length > 253 || !DNS_SUBDOMAIN_PATTERN.test(prefix))) {
    return "Label key prefix must be a DNS subdomain.";
  }
  return undefined;
}

function validateLabelValue(value: string) {
  const labelValue = value.trim();
  if (!labelValue) return "Label value is required.";
  if (labelValue.length > 63 || (labelValue && !LABEL_NAME_PATTERN.test(labelValue))) {
    return "Label value is invalid.";
  }
  return undefined;
}

function kindUsesLabels(kind: ResourceKind) {
  return kind === "Pod" || kind === "Deployment" || kind === "Service";
}

export function validateManifestFields(input: ValidationInput) {
  const errors: Record<string, string> = {};
  const add = (key: string, error?: string) => {
    if (error) errors[key] = error;
  };

  add(
    "name",
    validateDnsName(
      input.name,
      `${input.kind} name`,
      input.kind === "Service" || input.kind === "Route",
    ),
  );
  if (input.kind === "CronJob" && input.name.length > 52) {
    errors.name = "CronJob name must be 52 characters or fewer.";
  }
  if (input.kind !== "PersistentVolume") {
    add("namespace", validateDnsName(input.namespace, "Namespace", true));
  }
  if (kindUsesLabels(input.kind)) {
    if (input.labels.length === 0) {
      errors.labels = "Add at least one label.";
    }
    const labelKeys = new Set<string>();
    input.labels.forEach((label) => {
      const key = label.key.trim();
      add(`label-key-${label.id}`, validateLabelKey(label.key));
      add(`label-value-${label.id}`, validateLabelValue(label.value));
      if (key && labelKeys.has(key)) {
        errors[`label-key-${label.id}`] = "Label keys must be unique.";
      }
      if (key) labelKeys.add(key);
    });
  }

  if (input.kind === "Deployment") {
    const replicaCount = Number(input.replicas);
    if (!Number.isInteger(replicaCount) || replicaCount < 0) {
      errors.replicas = "Replicas must be a non-negative integer.";
    }
  }

  if (input.kind === "Job" || input.kind === "CronJob") {
    add("completions", validateNonNegativeInteger(input.completions, "Completions"));
    add("parallelism", validateNonNegativeInteger(input.parallelism, "Parallelism"));
    add("backoffLimit", validateNonNegativeInteger(input.backoffLimit, "Backoff limit"));
  }

  if (input.kind === "CronJob" && !input.schedule.trim()) {
    errors.schedule = "Schedule is required.";
  }

  if (input.kind === "PersistentVolumeClaim" || input.kind === "PersistentVolume") {
    if (input.storageAccessModes.length === 0) {
      errors.storageAccessModes = "Select at least one access mode.";
    }
    if (input.storageClassName.trim()) {
      add(
        "storageClassName",
        validateDnsName(input.storageClassName, "Storage class name"),
      );
    }

    if (input.kind === "PersistentVolumeClaim") {
      add(
        "storageRequest",
        validateStorageQuantity(input.storageRequest, "Storage request"),
      );
      if (input.pvcVolumeName.trim()) {
        add(
          "pvcVolumeName",
          validateDnsName(input.pvcVolumeName, "PersistentVolume name"),
        );
      }
      return errors;
    }

    add(
      "storageCapacity",
      validateStorageQuantity(input.storageCapacity, "Storage capacity"),
    );
    if (input.pvSourceType === "hostPath") {
      if (!input.pvHostPath.trim()) {
        errors.pvHostPath = "Host path is required.";
      } else if (!input.pvHostPath.startsWith("/")) {
        errors.pvHostPath = "Host path must be absolute and start with /.";
      }
    } else if (input.pvSourceType === "nfs") {
      if (!input.pvNfsServer.trim()) errors.pvNfsServer = "NFS server is required.";
      if (!input.pvNfsPath.trim()) {
        errors.pvNfsPath = "NFS export path is required.";
      } else if (!input.pvNfsPath.startsWith("/")) {
        errors.pvNfsPath = "NFS export path must start with /.";
      }
    } else if (input.pvSourceType === "csi") {
      add("pvCsiDriver", validateDnsName(input.pvCsiDriver, "CSI driver"));
      if (!input.pvCsiVolumeHandle.trim()) {
        errors.pvCsiVolumeHandle = "Volume handle is required.";
      }
    }
    return errors;
  }

  if (input.kind === "Route") {
    add(
      "routeServiceName",
      validateDnsName(input.routeServiceName, "Service name", true),
    );
    if (input.routeHost.trim()) {
      add("routeHost", validateDnsName(input.routeHost, "Hostname"));
    }
    if (input.routePath.trim() && !input.routePath.startsWith("/")) {
      errors.routePath = "Path must start with /.";
    } else if (/\s/.test(input.routePath)) {
      errors.routePath = "Path cannot contain spaces.";
    }
    if (input.routeTargetPort.trim()) {
      if (/^\d+$/.test(input.routeTargetPort)) {
        add("routeTargetPort", validatePort(input.routeTargetPort, "Target port"));
      } else {
        add("routeTargetPort", validatePortName(input.routeTargetPort));
      }
    }
    return errors;
  }

  if (input.kind === "Service") {
    const portNames = new Set<string>();
    input.servicePorts.forEach((port) => {
      add(`service-port-name-${port.id}`, validatePortName(port.name));
      add(`service-port-${port.id}`, validatePort(port.port, "Service port"));
      add(`service-target-port-${port.id}`, validatePort(port.targetPort, "Target port", false));
      if (input.servicePorts.length > 1 && !port.name) {
        errors[`service-port-name-${port.id}`] = "A unique name is required when a Service has multiple ports.";
      } else if (port.name && portNames.has(port.name)) {
        errors[`service-port-name-${port.id}`] = "Service port names must be unique.";
      }
      if (port.name) portNames.add(port.name);
    });
    return errors;
  }

  const containerNames = new Set<string>();
  input.containers.forEach((container) => {
    add(`container-name-${container.id}`, validateDnsName(container.name, "Container name", true));
    if (!container.image.trim()) errors[`container-image-${container.id}`] = "Container image is required.";
    if (containerNames.has(container.name)) {
      errors[`container-name-${container.id}`] = "Container names must be unique within a Pod.";
    }
    containerNames.add(container.name);

    const portNames = new Set<string>();
    container.ports.forEach((port) => {
      add(`container-port-name-${container.id}-${port.id}`, validatePortName(port.name));
      add(`container-port-${container.id}-${port.id}`, validatePort(port.port, "Container port"));
      if (port.name && portNames.has(port.name)) {
        errors[`container-port-name-${container.id}-${port.id}`] = "Port names must be unique within a container.";
      }
      if (port.name) portNames.add(port.name);
    });
  });

  const volumeNames = new Set<string>();
  input.volumes.forEach((volume) => {
    add(`volume-name-${volume.id}`, validateDnsName(volume.name, "Volume name", true));
    if (volumeNames.has(volume.name)) {
      errors[`volume-name-${volume.id}`] = "Volume names must be unique within a Pod.";
    }
    volumeNames.add(volume.name);

    if (volume.type !== "emptyDir" && volume.source.trim()) {
      add(`volume-source-${volume.id}`, validateDnsName(volume.source, "Existing object name"));
    }
    volume.mountPoints.forEach((mountPoint) => {
      if (!input.containers.some((container) => container.id === mountPoint.containerId)) {
        errors[`mount-container-${volume.id}-${mountPoint.id}`] = "Select an existing container.";
      }
      if (!mountPoint.mountPath.trim()) {
        errors[`mount-path-${volume.id}-${mountPoint.id}`] = "Mount path is required.";
      } else if (!mountPoint.mountPath.startsWith("/")) {
        errors[`mount-path-${volume.id}-${mountPoint.id}`] = "Mount path must be absolute and start with /.";
      }
    });
  });

  if (input.securityExpanded && input.serviceAccount.trim()) {
    add("service-account", validateDnsName(input.serviceAccount, "Service account name"));
  }

  return errors;
}
