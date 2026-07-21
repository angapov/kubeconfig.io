import type { ValidationErrors, ValidationInput } from "./types";

const DNS_SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const LABEL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
const PORT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const STORAGE_QUANTITY_PATTERN = /^\+?(?:\d+(?:\.\d+)?|\.\d+)(?:(?:[eE][+-]?\d+)|(?:[EPTGMk]i?)|m)?$/;
const CPU_QUANTITY_PATTERN = /^\+?(?:\d+(?:\.\d+)?|\.\d+)(?:(?:[eE][+-]?\d+)|m)?$/;
const MEMORY_QUANTITY_PATTERN = /^\+?(?:\d+(?:\.\d+)?|\.\d+)(?:(?:[eE][+-]?\d+)|Ei|Pi|Ti|Gi|Mi|Ki|E|P|T|G|M|k|m)?$/;

const MEMORY_MULTIPLIERS: Record<string, number> = {
  "": 1,
  m: 1e-3,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

export function addError(errors: ValidationErrors, key: string, error?: string) {
  if (error) errors[key] = error;
}

export function validateDnsName(value: string, label: string, labelOnly = false) {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const maximum = labelOnly ? 63 : 253;
  const pattern = labelOnly ? DNS_LABEL_PATTERN : DNS_SUBDOMAIN_PATTERN;
  if (trimmed.length > maximum || !pattern.test(trimmed)) {
    return `${label} must use lowercase letters, numbers${labelOnly ? "" : ", dots"}, or hyphens and start and end with a letter or number.`;
  }
  return undefined;
}

export function validatePort(value: string, label: string, required = true) {
  if (!value.trim()) return required ? `${label} is required.` : undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return `${label} must be an integer from 1 to 65535.`;
  }
  return undefined;
}

export function validatePortName(value: string) {
  if (!value) return undefined;
  if (value.length > 15 || !PORT_NAME_PATTERN.test(value) || !/[a-z]/.test(value)) {
    return "Port name must be 15 characters or fewer, contain a letter, and use lowercase letters, numbers, or hyphens.";
  }
  return undefined;
}

export function validateNonNegativeInteger(value: string, label: string) {
  const parsed = Number(value);
  if (!value.trim() || !Number.isInteger(parsed) || parsed < 0) {
    return `${label} must be a non-negative integer.`;
  }
  return undefined;
}

export function validateStorageQuantity(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (!STORAGE_QUANTITY_PATTERN.test(trimmed) || Number.parseFloat(trimmed) <= 0) {
    return `${label} must be a positive Kubernetes quantity such as 1Gi or 500Mi.`;
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
  if (labelValue.length > 63 || !LABEL_NAME_PATTERN.test(labelValue)) {
    return "Label value is invalid.";
  }
  return undefined;
}

export function validateObjectMetadata(
  input: ValidationInput,
  errors: ValidationErrors,
  options: {
    clusterScoped?: boolean;
    labelsRequired?: boolean;
    nameLabelOnly?: boolean;
  } = {},
) {
  addError(
    errors,
    "name",
    validateDnsName(input.name, `${input.kind} name`, options.nameLabelOnly),
  );
  if (!options.clusterScoped && input.namespace.trim()) {
    addError(errors, "namespace", validateDnsName(input.namespace, "Namespace", true));
  }
  if (options.labelsRequired && input.labels.length === 0) {
    errors.labels = "Add at least one label.";
  }

  const labelKeys = new Set<string>();
  input.labels.forEach((label) => {
    const key = label.key.trim();
    addError(errors, `label-key-${label.id}`, validateLabelKey(label.key));
    addError(errors, `label-value-${label.id}`, validateLabelValue(label.value));
    if (key && labelKeys.has(key)) {
      errors[`label-key-${label.id}`] = "Label keys must be unique.";
    }
    if (key) labelKeys.add(key);
  });
}

function parseCpuQuantity(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !CPU_QUANTITY_PATTERN.test(trimmed)) return undefined;
  const normalized = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const cpu = normalized.endsWith("m")
    ? Number(normalized.slice(0, -1)) / 1000
    : Number(normalized);
  const milliCpu = cpu * 1000;
  if (
    !Number.isFinite(cpu) ||
    cpu < 0 ||
    Math.abs(milliCpu - Math.round(milliCpu)) > 1e-9
  ) {
    return undefined;
  }
  return cpu;
}

function parseMemoryQuantity(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !MEMORY_QUANTITY_PATTERN.test(trimmed)) return undefined;
  const normalized = trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const exponentMatch = normalized.match(/^(.+?)[eE]([+-]?\d+)$/);
  if (exponentMatch) {
    const bytes = Number(exponentMatch[1]) * 10 ** Number(exponentMatch[2]);
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
  }
  const suffix = Object.keys(MEMORY_MULTIPLIERS)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .find((candidate) => normalized.endsWith(candidate)) ?? "";
  const amount = Number(suffix ? normalized.slice(0, -suffix.length) : normalized);
  const bytes = amount * MEMORY_MULTIPLIERS[suffix];
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
}

function validateCpuQuantity(value: string, label: string) {
  if (!value.trim()) return undefined;
  if (parseCpuQuantity(value) === undefined) {
    return `${label} must be a non-negative CPU quantity with at least 1m precision, such as 250m or 0.5.`;
  }
  return undefined;
}

function validateMemoryQuantity(value: string, label: string) {
  if (!value.trim()) return undefined;
  if (parseMemoryQuantity(value) === undefined) {
    return `${label} must be a non-negative memory quantity such as 256Mi or 1G.`;
  }
  return undefined;
}

export function validateJobSpec(input: ValidationInput, errors: ValidationErrors) {
  addError(errors, "completions", validateNonNegativeInteger(input.completions, "Completions"));
  addError(errors, "parallelism", validateNonNegativeInteger(input.parallelism, "Parallelism"));
  addError(errors, "backoffLimit", validateNonNegativeInteger(input.backoffLimit, "Backoff limit"));
}

export function validateStorageSpec(input: ValidationInput, errors: ValidationErrors) {
  if (input.storageAccessModes.length === 0) {
    errors.storageAccessModes = "Select at least one access mode.";
  }
  if (input.storageClassName.trim()) {
    addError(
      errors,
      "storageClassName",
      validateDnsName(input.storageClassName, "Storage class name"),
    );
  }
}

export function validatePodTemplate(input: ValidationInput, errors: ValidationErrors) {
  const containerNames = new Set<string>();
  input.containers.forEach((container) => {
    addError(
      errors,
      `container-name-${container.id}`,
      validateDnsName(container.name, "Container name", true),
    );
    if (!container.image.trim()) {
      errors[`container-image-${container.id}`] = "Container image is required.";
    }
    if (containerNames.has(container.name)) {
      errors[`container-name-${container.id}`] = "Container names must be unique within a Pod.";
    }
    containerNames.add(container.name);

    const portNames = new Set<string>();
    container.ports.forEach((port) => {
      addError(
        errors,
        `container-port-name-${container.id}-${port.id}`,
        validatePortName(port.name),
      );
      addError(
        errors,
        `container-port-${container.id}-${port.id}`,
        validatePort(port.port, "Container port"),
      );
      if (port.name && portNames.has(port.name)) {
        errors[`container-port-name-${container.id}-${port.id}`] =
          "Port names must be unique within a container.";
      }
      if (port.name) portNames.add(port.name);
    });

    if (container.resourcesEnabled) {
      addError(
        errors,
        `container-cpu-request-${container.id}`,
        validateCpuQuantity(container.cpuRequest, "CPU request"),
      );
      addError(
        errors,
        `container-memory-request-${container.id}`,
        validateMemoryQuantity(container.memoryRequest, "Memory request"),
      );
      addError(
        errors,
        `container-cpu-limit-${container.id}`,
        validateCpuQuantity(container.cpuLimit, "CPU limit"),
      );
      addError(
        errors,
        `container-memory-limit-${container.id}`,
        validateMemoryQuantity(container.memoryLimit, "Memory limit"),
      );

      const cpuRequest = parseCpuQuantity(container.cpuRequest);
      const cpuLimit = parseCpuQuantity(container.cpuLimit);
      if (cpuRequest !== undefined && cpuLimit !== undefined && cpuLimit < cpuRequest) {
        errors[`container-cpu-limit-${container.id}`] =
          "CPU limit must be greater than or equal to CPU request.";
      }

      const memoryRequest = parseMemoryQuantity(container.memoryRequest);
      const memoryLimit = parseMemoryQuantity(container.memoryLimit);
      if (
        memoryRequest !== undefined &&
        memoryLimit !== undefined &&
        memoryLimit < memoryRequest
      ) {
        errors[`container-memory-limit-${container.id}`] =
          "Memory limit must be greater than or equal to memory request.";
      }
    }
  });

  const volumeNames = new Set<string>();
  input.volumes.forEach((volume) => {
    addError(
      errors,
      `volume-name-${volume.id}`,
      validateDnsName(volume.name, "Volume name", true),
    );
    if (volumeNames.has(volume.name)) {
      errors[`volume-name-${volume.id}`] = "Volume names must be unique within a Pod.";
    }
    volumeNames.add(volume.name);

    if (volume.type !== "emptyDir" && volume.source.trim()) {
      addError(
        errors,
        `volume-source-${volume.id}`,
        validateDnsName(volume.source, "Existing object name"),
      );
    }
    volume.mountPoints.forEach((mountPoint) => {
      if (!input.containers.some((container) => container.id === mountPoint.containerId)) {
        errors[`mount-container-${volume.id}-${mountPoint.id}`] =
          "Select an existing container.";
      }
      if (!mountPoint.mountPath.trim()) {
        errors[`mount-path-${volume.id}-${mountPoint.id}`] = "Mount path is required.";
      } else if (!mountPoint.mountPath.startsWith("/")) {
        errors[`mount-path-${volume.id}-${mountPoint.id}`] =
          "Mount path must be absolute and start with /.";
      }
    });
  });

  if (input.securityExpanded && input.serviceAccount.trim()) {
    addError(
      errors,
      "service-account",
      validateDnsName(input.serviceAccount, "Service account name"),
    );
  }
}
