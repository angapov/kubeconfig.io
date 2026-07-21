type ResourceKind = "Deployment" | "Pod" | "Service";

type PortInput = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
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
  labels: string;
  replicas: string;
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

function validatePortName(value: string) {
  if (!value) return undefined;
  if (value.length > 15 || !PORT_NAME_PATTERN.test(value) || !/[a-z]/.test(value)) {
    return "Port name must be 15 characters or fewer, contain a letter, and use lowercase letters, numbers, or hyphens.";
  }
  return undefined;
}

function validateLabels(value: string) {
  for (const entry of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.includes("=") ? "=" : entry.includes(":") ? ":" : "";
    if (!separator) return `Label "${entry}" must use key=value.`;
    const [rawKey, ...valueParts] = entry.split(separator);
    const key = rawKey.trim();
    const labelValue = valueParts.join(separator).trim();
    const slash = key.lastIndexOf("/");
    const prefix = slash >= 0 ? key.slice(0, slash) : "";
    const keyName = slash >= 0 ? key.slice(slash + 1) : key;
    if (!keyName || keyName.length > 63 || !LABEL_NAME_PATTERN.test(keyName)) {
      return `Label key "${key}" is invalid.`;
    }
    if (prefix && (prefix.length > 253 || !DNS_SUBDOMAIN_PATTERN.test(prefix))) {
      return `Label prefix "${prefix}" must be a DNS subdomain.`;
    }
    if (labelValue.length > 63 || (labelValue && !LABEL_NAME_PATTERN.test(labelValue))) {
      return `Label value "${labelValue}" is invalid.`;
    }
  }
  return undefined;
}

export function validateManifestFields(input: ValidationInput) {
  const errors: Record<string, string> = {};
  const add = (key: string, error?: string) => {
    if (error) errors[key] = error;
  };

  add("name", validateDnsName(input.name, `${input.kind} name`, input.kind === "Service"));
  add("namespace", validateDnsName(input.namespace, "Namespace", true));
  add("labels", validateLabels(input.labels));

  if (input.kind === "Deployment") {
    const replicaCount = Number(input.replicas);
    if (!Number.isInteger(replicaCount) || replicaCount < 0) {
      errors.replicas = "Replicas must be a non-negative integer.";
    }
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
