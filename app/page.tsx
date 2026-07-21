"use client";

import { useMemo, useRef, useState, type SetStateAction } from "react";
import { validateManifestFields } from "./validation";

type Platform = "Kubernetes" | "OpenShift";
type ResourceKind =
  | "Deployment"
  | "Pod"
  | "Service"
  | "Job"
  | "CronJob"
  | "Route"
  | "PersistentVolumeClaim"
  | "PersistentVolume";
type Protocol = "TCP" | "UDP" | "SCTP";
type VolumeType = "emptyDir" | "configMap" | "secret" | "persistentVolumeClaim";
type PvSourceType = "hostPath" | "nfs" | "csi";

const RESOURCE_KIND_ABBREVIATIONS: Record<ResourceKind, string> = {
  CronJob: "CJ",
  Deployment: "D",
  Pod: "P",
  Job: "J",
  Service: "S",
  Route: "R",
  PersistentVolumeClaim: "PVC",
  PersistentVolume: "PV",
};

type PortField = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
  protocol: Protocol;
};

type LabelField = {
  id: number;
  key: string;
  value: string;
};

type ContainerField = {
  id: number;
  name: string;
  image: string;
  pullPolicy: string;
  ports: PortField[];
  resourcesEnabled: boolean;
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
};

type MountPointField = {
  id: number;
  containerId: number;
  mountPath: string;
};

type VolumeField = {
  id: number;
  name: string;
  type: VolumeType;
  source: string;
  readOnly: boolean;
  mountPoints: MountPointField[];
};

type ResourceState = {
  id: number;
  kind: ResourceKind;
  name: string;
  namespace: string;
  labels: LabelField[];
  replicas: string;
  completions: string;
  parallelism: string;
  backoffLimit: string;
  schedule: string;
  concurrencyPolicy: string;
  serviceAccount: string;
  securityExpanded: boolean;
  restartPolicy: string;
  serviceType: string;
  routeHost: string;
  routePath: string;
  routeServiceName: string;
  routeTargetPort: string;
  routeTlsEnabled: boolean;
  routeTlsTermination: string;
  routeInsecurePolicy: string;
  storageAccessModes: string[];
  storageVolumeMode: string;
  storageClassName: string;
  storageRequest: string;
  storageCapacity: string;
  pvcVolumeName: string;
  pvReclaimPolicy: string;
  pvSourceType: PvSourceType;
  pvHostPath: string;
  pvHostPathType: string;
  pvNfsServer: string;
  pvNfsPath: string;
  pvNfsReadOnly: boolean;
  pvCsiDriver: string;
  pvCsiVolumeHandle: string;
  pvCsiFsType: string;
  containers: ContainerField[];
  servicePorts: PortField[];
  volumes: VolumeField[];
};

type YamlValue = string | number | boolean | YamlObject | YamlValue[];
interface YamlObject {
  [key: string]: YamlValue | undefined;
}

const KUBERNETES_VERSION_OPTIONS = ["1.36", "1.35", "1.34", "1.33", "1.32"];
const OPENSHIFT_VERSION_OPTIONS = ["4.22", "4.21", "4.20", "4.19", "4.18"];

function kindUsesLabels(kind: ResourceKind) {
  return kind === "Pod" || kind === "Deployment" || kind === "Service";
}

function isDefaultLabelSet(labels: LabelField[]) {
  return labels.length === 1 && labels[0].key === "app" && labels[0].value === "example";
}

function createDefaultLabel(id = Date.now()): LabelField {
  return { id, key: "app", value: "example" };
}

function createDefaultPort(index: number, id = Date.now()): PortField {
  if (index === 0) {
    return { id, name: "http", port: "80", targetPort: "80", protocol: "TCP" };
  }
  if (index === 1) {
    return { id, name: "https", port: "443", targetPort: "443", protocol: "TCP" };
  }
  return { id, name: "", port: "", targetPort: "", protocol: "TCP" };
}

function getVolumeSourcePlaceholder(type: VolumeType) {
  if (type === "persistentVolumeClaim") return "Existing PVC name";
  if (type === "configMap") return "Existing ConfigMap name";
  if (type === "secret") return "Existing Secret name";
  return "1Gi (optional)";
}

function isPlainObject(value: unknown): value is YamlObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function yamlScalar(value: string | number | boolean) {
  if (typeof value !== "string") return String(value);
  if (value === "" || /^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(value)) {
    return JSON.stringify(value);
  }
  if (/^[A-Za-z0-9_./@:-]+$/.test(value) && !/^[?:-](?:\s|$)/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function toYaml(object: YamlObject, indent = 0): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];

  Object.entries(object).forEach(([key, value]) => {
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return;

    if (Array.isArray(value)) {
      lines.push(`${pad}${key}:`);
      value.forEach((item) => {
        if (!isPlainObject(item)) {
          lines.push(`${pad}  - ${yamlScalar(item as string | number | boolean)}`);
          return;
        }

        const entries = Object.entries(item).filter(([, child]) => child !== undefined && child !== "");
        const first = entries[0];
        if (!first) {
          lines.push(`${pad}  - {}`);
          return;
        }

        const [firstKey, firstValue] = first;
        if (!Array.isArray(firstValue) && !isPlainObject(firstValue)) {
          lines.push(`${pad}  - ${firstKey}: ${yamlScalar(firstValue as string | number | boolean)}`);
          lines.push(...toYaml(Object.fromEntries(entries.slice(1)) as YamlObject, indent + 4));
        } else {
          lines.push(`${pad}  -`);
          lines.push(...toYaml(item, indent + 4));
        }
      });
      return;
    }

    if (isPlainObject(value)) {
      const childLines = toYaml(value, indent + 2);
      if (childLines.length === 0) {
        lines.push(`${pad}${key}: {}`);
      } else {
        lines.push(`${pad}${key}:`);
        lines.push(...childLines);
      }
      return;
    }

    lines.push(`${pad}${key}: ${yamlScalar(value)}`);
  });

  return lines;
}

function parseLabels(value: LabelField[]) {
  return Object.fromEntries(
    value
      .map((label) => [label.key.trim(), label.value.trim()])
      .filter(([key]) => Boolean(key)),
  );
}

function createDefaultResource(id: number): ResourceState {
  return {
    id,
    kind: "Deployment",
    name: "",
    namespace: "",
    labels: [createDefaultLabel(1)],
    replicas: "1",
    completions: "1",
    parallelism: "1",
    backoffLimit: "6",
    schedule: "*/5 * * * *",
    concurrencyPolicy: "Allow",
    serviceAccount: "default",
    securityExpanded: false,
    restartPolicy: "Always",
    serviceType: "ClusterIP",
    routeHost: "",
    routePath: "",
    routeServiceName: "",
    routeTargetPort: "http",
    routeTlsEnabled: false,
    routeTlsTermination: "edge",
    routeInsecurePolicy: "None",
    storageAccessModes: ["ReadWriteOnce"],
    storageVolumeMode: "Filesystem",
    storageClassName: "",
    storageRequest: "1Gi",
    storageCapacity: "10Gi",
    pvcVolumeName: "",
    pvReclaimPolicy: "Retain",
    pvSourceType: "hostPath",
    pvHostPath: "/mnt/data",
    pvHostPathType: "DirectoryOrCreate",
    pvNfsServer: "",
    pvNfsPath: "/exports/data",
    pvNfsReadOnly: false,
    pvCsiDriver: "",
    pvCsiVolumeHandle: "",
    pvCsiFsType: "ext4",
    containers: [
      {
        id: 1,
        name: "container-1",
        image: "nginx:latest",
        pullPolicy: "IfNotPresent",
        ports: [],
        resourcesEnabled: false,
        cpuRequest: "250m",
        memoryRequest: "256Mi",
        cpuLimit: "500m",
        memoryLimit: "512Mi",
      },
    ],
    servicePorts: [createDefaultPort(0, 1)],
    volumes: [
      {
        id: 1,
        name: "data",
        type: "persistentVolumeClaim",
        source: "",
        readOnly: false,
        mountPoints: [{ id: 1, containerId: 1, mountPath: "/mnt" }],
      },
    ],
  };
}

function buildResourceManifest(resourceState: ResourceState) {
  const {
    backoffLimit,
    completions,
    concurrencyPolicy,
    containers,
    kind,
    labels,
    name,
    namespace,
    replicas,
    restartPolicy,
    routeHost,
    routeInsecurePolicy,
    routePath,
    routeServiceName,
    routeTargetPort,
    routeTlsEnabled,
    routeTlsTermination,
    schedule,
    securityExpanded,
    serviceAccount,
    servicePorts,
    serviceType,
    storageAccessModes,
    storageCapacity,
    storageClassName,
    storageRequest,
    storageVolumeMode,
    parallelism,
    pvcVolumeName,
    pvCsiDriver,
    pvCsiFsType,
    pvCsiVolumeHandle,
    pvHostPath,
    pvHostPathType,
    pvNfsPath,
    pvNfsReadOnly,
    pvNfsServer,
    pvReclaimPolicy,
    pvSourceType,
    volumes,
  } = resourceState;
  const parsedLabels = parseLabels(labels);
  const resourceLabels = Object.keys(parsedLabels).length > 0 ? parsedLabels : undefined;
  const metadata: YamlObject = {
    name: name.trim() || undefined,
    namespace: kind === "PersistentVolume" ? undefined : namespace.trim() || undefined,
    labels: resourceLabels,
  };

  const volumeSpecs = volumes.map((volume) => {
    const volumeName = volume.name || "volume";
    if (volume.type === "configMap") {
      return { name: volumeName, configMap: { name: volume.source || `${volumeName}-config` } };
    }
    if (volume.type === "secret") {
      return { name: volumeName, secret: { secretName: volume.source || `${volumeName}-secret` } };
    }
    if (volume.type === "persistentVolumeClaim") {
      return {
        name: volumeName,
        persistentVolumeClaim: { claimName: volume.source || `${volumeName}-pvc` },
      };
    }
    return {
      name: volumeName,
      emptyDir: volume.source ? { sizeLimit: volume.source } : {},
    };
  });

  const containerSpecs = containers.map((container) => ({
    name: container.name || "app",
    image: container.image || "nginx:latest",
    imagePullPolicy: container.pullPolicy,
    ports: container.ports
      .filter((port) => port.port.trim() !== "")
      .map((port) => ({
        name: port.name || undefined,
        containerPort: Number(port.port),
        protocol: port.protocol,
      })),
    resources: container.resourcesEnabled
      ? {
          requests: {
            cpu: container.cpuRequest || undefined,
            memory: container.memoryRequest || undefined,
          },
          limits: {
            cpu: container.cpuLimit || undefined,
            memory: container.memoryLimit || undefined,
          },
        }
      : undefined,
    volumeMounts: volumes.flatMap((volume) =>
      volume.mountPoints
        .filter((mountPoint) => mountPoint.containerId === container.id)
        .map((mountPoint) => ({
          name: volume.name || "volume",
          mountPath: mountPoint.mountPath || "/mnt",
          readOnly: volume.readOnly || undefined,
        })),
    ),
  }));

  let resource: YamlObject;

  if (kind === "PersistentVolumeClaim") {
    resource = {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata,
      spec: {
        accessModes: storageAccessModes,
        volumeMode: storageVolumeMode,
        resources: {
          requests: {
            storage: storageRequest.trim(),
          },
        },
        storageClassName: storageClassName.trim() || undefined,
        volumeName: pvcVolumeName.trim() || undefined,
      },
    };
  } else if (kind === "PersistentVolume") {
    const source: YamlObject =
      pvSourceType === "nfs"
        ? {
            nfs: {
              server: pvNfsServer.trim(),
              path: pvNfsPath.trim(),
              readOnly: pvNfsReadOnly || undefined,
            },
          }
        : pvSourceType === "csi"
          ? {
              csi: {
                driver: pvCsiDriver.trim(),
                volumeHandle: pvCsiVolumeHandle.trim(),
                fsType:
                  storageVolumeMode === "Filesystem"
                    ? pvCsiFsType.trim() || undefined
                    : undefined,
              },
            }
          : {
              hostPath: {
                path: pvHostPath.trim(),
                type: pvHostPathType,
              },
            };

    resource = {
      apiVersion: "v1",
      kind: "PersistentVolume",
      metadata,
      spec: {
        capacity: {
          storage: storageCapacity.trim(),
        },
        accessModes: storageAccessModes,
        volumeMode: storageVolumeMode,
        persistentVolumeReclaimPolicy: pvReclaimPolicy,
        storageClassName: storageClassName.trim() || undefined,
        ...source,
      },
    };
  } else if (kind === "Route") {
    const trimmedTargetPort = routeTargetPort.trim();
    resource = {
      apiVersion: "route.openshift.io/v1",
      kind: "Route",
      metadata,
      spec: {
        host: routeHost.trim() || undefined,
        path: routePath.trim() || undefined,
        to: {
          kind: "Service",
          name: routeServiceName.trim(),
        },
        port: trimmedTargetPort
          ? {
              targetPort: /^\d+$/.test(trimmedTargetPort)
                ? Number(trimmedTargetPort)
                : trimmedTargetPort,
            }
          : undefined,
        tls: routeTlsEnabled
          ? {
              termination: routeTlsTermination,
              insecureEdgeTerminationPolicy: routeInsecurePolicy,
            }
          : undefined,
      },
    };
  } else if (kind === "Service") {
    resource = {
      apiVersion: "v1",
      kind: "Service",
      metadata,
      spec: {
        type: serviceType,
        selector: parsedLabels,
        ports: servicePorts
          .filter((port) => port.port.trim() !== "")
          .map((port) => ({
            name: port.name || undefined,
            port: Number(port.port),
            targetPort: Number(port.targetPort) || Number(port.port),
            protocol: port.protocol,
          })),
      },
    };
  } else {
    const podSpec: YamlObject = {
      serviceAccountName: securityExpanded ? serviceAccount || undefined : undefined,
      restartPolicy: kind === "Deployment" ? undefined : restartPolicy,
      containers: containerSpecs,
      volumes: volumeSpecs,
    };

    const jobSpec: YamlObject = {
      completions: Number(completions),
      parallelism: Number(parallelism),
      backoffLimit: Number(backoffLimit),
      template: {
        spec: podSpec,
      },
    };

    if (kind === "Pod") {
      resource = {
        apiVersion: "v1",
        kind: "Pod",
        metadata,
        spec: podSpec,
      };
    } else if (kind === "Job") {
      resource = {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata,
        spec: jobSpec,
      };
    } else if (kind === "CronJob") {
      resource = {
        apiVersion: "batch/v1",
        kind: "CronJob",
        metadata,
        spec: {
          schedule,
          concurrencyPolicy,
          jobTemplate: { spec: jobSpec },
        },
      };
    } else {
      resource = {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata,
        spec: {
          replicas: Number(replicas) || 1,
          selector: { matchLabels: parsedLabels },
          template: {
            metadata: { labels: parsedLabels },
            spec: podSpec,
          },
        },
      };
    }
  }

  return `${toYaml(resource).join("\n")}\n`;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <label className={`field${error ? " field-invalid" : ""}`}>
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        min={type === "number" ? 0 : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        aria-invalid={Boolean(error)}
      />
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} required={required}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Home() {
  const [platform, setPlatform] = useState<Platform>("Kubernetes");
  const [kubernetesVersion, setKubernetesVersion] = useState("1.36");
  const [openShiftVersion, setOpenShiftVersion] = useState("4.22");
  const [resources, setResources] = useState<ResourceState[]>(() => [createDefaultResource(1)]);
  const [activeResourceId, setActiveResourceId] = useState(1);
  const nextResourceId = useRef(2);
  const [copied, setCopied] = useState(false);

  const activeResource =
    resources.find((resource) => resource.id === activeResourceId) ?? resources[0];
  const {
    backoffLimit,
    completions,
    concurrencyPolicy,
    containers,
    kind,
    labels,
    name,
    namespace,
    replicas,
    restartPolicy,
    routeHost,
    routeInsecurePolicy,
    routePath,
    routeServiceName,
    routeTargetPort,
    routeTlsEnabled,
    routeTlsTermination,
    schedule,
    securityExpanded,
    serviceAccount,
    servicePorts,
    serviceType,
    storageAccessModes,
    storageCapacity,
    storageClassName,
    storageRequest,
    storageVolumeMode,
    parallelism,
    pvcVolumeName,
    pvCsiDriver,
    pvCsiFsType,
    pvCsiVolumeHandle,
    pvHostPath,
    pvHostPathType,
    pvNfsPath,
    pvNfsReadOnly,
    pvNfsServer,
    pvReclaimPolicy,
    pvSourceType,
    volumes,
  } = activeResource;

  function setResourceField<Key extends keyof ResourceState>(
    key: Key,
    value: SetStateAction<ResourceState[Key]>,
  ) {
    setResources((current) =>
      current.map((resource) => {
        if (resource.id !== activeResourceId) return resource;
        const nextValue =
          typeof value === "function"
            ? (value as (previous: ResourceState[Key]) => ResourceState[Key])(resource[key])
            : value;
        return { ...resource, [key]: nextValue };
      }),
    );
  }

  const setName = (value: SetStateAction<string>) => setResourceField("name", value);
  const setNamespace = (value: SetStateAction<string>) => setResourceField("namespace", value);
  const setLabels = (value: SetStateAction<LabelField[]>) => setResourceField("labels", value);
  const setReplicas = (value: SetStateAction<string>) => setResourceField("replicas", value);
  const setCompletions = (value: SetStateAction<string>) => setResourceField("completions", value);
  const setParallelism = (value: SetStateAction<string>) => setResourceField("parallelism", value);
  const setBackoffLimit = (value: SetStateAction<string>) => setResourceField("backoffLimit", value);
  const setSchedule = (value: SetStateAction<string>) => setResourceField("schedule", value);
  const setConcurrencyPolicy = (value: SetStateAction<string>) => setResourceField("concurrencyPolicy", value);
  const setServiceAccount = (value: SetStateAction<string>) => setResourceField("serviceAccount", value);
  const setSecurityExpanded = (value: SetStateAction<boolean>) => setResourceField("securityExpanded", value);
  const setRestartPolicy = (value: SetStateAction<string>) => setResourceField("restartPolicy", value);
  const setServiceType = (value: SetStateAction<string>) => setResourceField("serviceType", value);
  const setRouteHost = (value: SetStateAction<string>) => setResourceField("routeHost", value);
  const setRoutePath = (value: SetStateAction<string>) => setResourceField("routePath", value);
  const setRouteServiceName = (value: SetStateAction<string>) => setResourceField("routeServiceName", value);
  const setRouteTargetPort = (value: SetStateAction<string>) => setResourceField("routeTargetPort", value);
  const setRouteTlsEnabled = (value: SetStateAction<boolean>) => setResourceField("routeTlsEnabled", value);
  const setRouteInsecurePolicy = (value: SetStateAction<string>) => setResourceField("routeInsecurePolicy", value);
  const setStorageAccessModes = (value: SetStateAction<string[]>) => setResourceField("storageAccessModes", value);
  const setStorageVolumeMode = (value: SetStateAction<string>) => setResourceField("storageVolumeMode", value);
  const setStorageClassName = (value: SetStateAction<string>) => setResourceField("storageClassName", value);
  const setStorageRequest = (value: SetStateAction<string>) => setResourceField("storageRequest", value);
  const setStorageCapacity = (value: SetStateAction<string>) => setResourceField("storageCapacity", value);
  const setPvcVolumeName = (value: SetStateAction<string>) => setResourceField("pvcVolumeName", value);
  const setPvReclaimPolicy = (value: SetStateAction<string>) => setResourceField("pvReclaimPolicy", value);
  const setPvHostPath = (value: SetStateAction<string>) => setResourceField("pvHostPath", value);
  const setPvHostPathType = (value: SetStateAction<string>) => setResourceField("pvHostPathType", value);
  const setPvNfsServer = (value: SetStateAction<string>) => setResourceField("pvNfsServer", value);
  const setPvNfsPath = (value: SetStateAction<string>) => setResourceField("pvNfsPath", value);
  const setPvNfsReadOnly = (value: SetStateAction<boolean>) => setResourceField("pvNfsReadOnly", value);
  const setPvCsiDriver = (value: SetStateAction<string>) => setResourceField("pvCsiDriver", value);
  const setPvCsiVolumeHandle = (value: SetStateAction<string>) => setResourceField("pvCsiVolumeHandle", value);
  const setPvCsiFsType = (value: SetStateAction<string>) => setResourceField("pvCsiFsType", value);
  const setContainers = (value: SetStateAction<ContainerField[]>) => setResourceField("containers", value);
  const setServicePorts = (value: SetStateAction<PortField[]>) => setResourceField("servicePorts", value);
  const setVolumes = (value: SetStateAction<VolumeField[]>) => setResourceField("volumes", value);

  function updateLabel(id: number, patch: Partial<LabelField>) {
    setLabels((current) =>
      current.map((label) => (label.id === id ? { ...label, ...patch } : label)),
    );
  }

  function toggleStorageAccessMode(mode: string, checked: boolean) {
    setStorageAccessModes((current) =>
      checked
        ? current.includes(mode) ? current : [...current, mode]
        : current.filter((item) => item !== mode),
    );
  }

  function changePvSourceType(nextSourceType: PvSourceType) {
    setResources((current) =>
      current.map((resource) =>
        resource.id === activeResourceId
          ? {
              ...resource,
              pvSourceType: nextSourceType,
              storageVolumeMode:
                nextSourceType === "nfs" ? "Filesystem" : resource.storageVolumeMode,
            }
          : resource,
      ),
    );
  }

  function changeResourceKind(nextKind: ResourceKind) {
    if (nextKind === "Route") setPlatform("OpenShift");
    setResources((current) =>
      current.map((resource) =>
        resource.id === activeResourceId
          ? {
              ...resource,
              kind: nextKind,
              labels:
                kindUsesLabels(nextKind) && resource.labels.length === 0
                  ? [createDefaultLabel()]
                  : !kindUsesLabels(nextKind) && isDefaultLabelSet(resource.labels)
                    ? []
                  : resource.labels,
              restartPolicy:
                (nextKind === "Job" || nextKind === "CronJob") && resource.restartPolicy === "Always"
                  ? "Never"
                  : resource.restartPolicy,
            }
          : resource,
      ),
    );
  }

  function changeRouteTlsTermination(nextTermination: string) {
    setResources((current) =>
      current.map((resource) =>
        resource.id === activeResourceId
          ? {
              ...resource,
              routeTlsTermination: nextTermination,
              routeInsecurePolicy:
                nextTermination === "passthrough" && resource.routeInsecurePolicy === "Allow"
                  ? "None"
                  : resource.routeInsecurePolicy,
            }
          : resource,
      ),
    );
  }

  const validationByResource = useMemo(
    () =>
      new Map(
        resources.map((resource) => [resource.id, validateManifestFields(resource)]),
      ),
    [resources],
  );
  const validationErrors = validationByResource.get(activeResourceId) ?? {};
  const validationErrorCount = Array.from(validationByResource.values()).reduce(
    (total, errors) => total + Object.keys(errors).length,
    0,
  );
  const isManifestValid = validationErrorCount === 0;

  const manifest = useMemo(
    () => resources.map(buildResourceManifest).join("---\n"),
    [resources],
  );

  function updateServicePort(id: number, patch: Partial<PortField>) {
    setServicePorts((current) =>
      current.map((port) => (port.id === id ? { ...port, ...patch } : port)),
    );
  }

  function updateContainer(id: number, patch: Partial<ContainerField>) {
    setContainers((current) =>
      current.map((container) => (container.id === id ? { ...container, ...patch } : container)),
    );
  }

  function updateContainerPort(containerId: number, portId: number, patch: Partial<PortField>) {
    setContainers((current) =>
      current.map((container) =>
        container.id === containerId
          ? {
              ...container,
              ports: container.ports.map((port) =>
                port.id === portId ? { ...port, ...patch } : port,
              ),
            }
          : container,
      ),
    );
  }

  function removeContainer(containerId: number) {
    if (containers.length === 1) return;
    setContainers((current) => current.filter((container) => container.id !== containerId));
    setVolumes((current) =>
      current.map((volume) => ({
        ...volume,
        mountPoints: volume.mountPoints.filter(
          (mountPoint) => mountPoint.containerId !== containerId,
        ),
      })),
    );
  }

  function updateVolume(id: number, patch: Partial<VolumeField>) {
    setVolumes((current) =>
      current.map((volume) => (volume.id === id ? { ...volume, ...patch } : volume)),
    );
  }

  function updateMountPoint(
    volumeId: number,
    mountPointId: number,
    patch: Partial<MountPointField>,
  ) {
    setVolumes((current) =>
      current.map((volume) =>
        volume.id === volumeId
          ? {
              ...volume,
              mountPoints: volume.mountPoints.map((mountPoint) =>
                mountPoint.id === mountPointId ? { ...mountPoint, ...patch } : mountPoint,
              ),
            }
          : volume,
      ),
    );
  }

  function addResourceTab() {
    if (resources.length >= 4) return;
    const resourceId = nextResourceId.current;
    nextResourceId.current += 1;
    setResources((current) => [...current, createDefaultResource(resourceId)]);
    setActiveResourceId(resourceId);
  }

  function closeResourceTab(resourceId: number) {
    if (resources.length === 1) return;
    const closingIndex = resources.findIndex((resource) => resource.id === resourceId);
    const nextResources = resources.filter((resource) => resource.id !== resourceId);
    setResources(nextResources);
    if (resourceId === activeResourceId) {
      setActiveResourceId(nextResources[Math.min(closingIndex, nextResources.length - 1)].id);
    }
  }

  async function copyManifest() {
    if (!isManifestValid) return;
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadManifest() {
    if (!isManifestValid) return;
    const blob = new Blob([manifest], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = manifestFileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const apiVersion =
    kind === "Deployment"
      ? "apps/v1"
      : kind === "Job" || kind === "CronJob"
        ? "batch/v1"
        : kind === "Route"
          ? "route.openshift.io/v1"
          : "v1";
  const version = platform === "OpenShift" ? openShiftVersion : kubernetesVersion;
  const versionOptions = platform === "OpenShift" ? OPENSHIFT_VERSION_OPTIONS : KUBERNETES_VERSION_OPTIONS;
  const isStorageResource = kind === "PersistentVolumeClaim" || kind === "PersistentVolume";
  const hasPodSpec = kind !== "Service" && kind !== "Route" && !isStorageResource;
  const manifestFileName = resources.length > 1
    ? platform === "OpenShift" ? "openshift-resources.yaml" : "kubernetes-resources.yaml"
    : `${name || kind.toLowerCase()}.yaml`;
  const manifestLines = manifest.split("\n");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            K
          </div>
          <div>
            <div className="brand-name">Kubeconfig.io</div>
            <div className="brand-tagline">Visual Kubernetes and OpenShift YAML builder</div>
          </div>
        </div>

        <div className="platform-controls">
          <div className="version-picker">
            <label htmlFor="platform">Platform</label>
            <select
              id="platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform)}
            >
              <option value="Kubernetes" disabled={resources.some((resource) => resource.kind === "Route")}>
                Kubernetes
              </option>
              <option value="OpenShift">OpenShift</option>
            </select>
          </div>
          <div className="version-picker">
            <label htmlFor="platform-version">{platform} version</label>
            <select
              id="platform-version"
              value={version}
              onChange={(event) =>
                platform === "OpenShift"
                  ? setOpenShiftVersion(event.target.value)
                  : setKubernetesVersion(event.target.value)
              }
            >
              {versionOptions.map((item) => (
                <option key={item} value={item}>
                  v{item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="schema-chip" title="The supported field map is bundled with this client-only site">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Schema ready</strong>
            <small>Bundled · client-side</small>
          </span>
        </div>
      </header>

      <section className="workspace">
        <div className="builder-panel">
          <div className="panel-heading">
            <p className="panel-kicker">RESOURCE CONFIGURATION</p>
            <div className="synced-state"><span />Synced</div>
          </div>

          <div className="resource-tabs" aria-label={`${platform} resources`}>
            <div className="resource-tab-list" role="tablist">
              {resources.map((resource, index) => {
                const tabErrorCount = Object.keys(validationByResource.get(resource.id) ?? {}).length;
                const isActive = resource.id === activeResourceId;
                return (
                  <div className={`resource-tab${isActive ? " active" : ""}`} key={resource.id}>
                    <button
                      type="button"
                      className="resource-tab-select"
                      role="tab"
                      aria-selected={isActive}
                      title={`${resource.kind}: ${resource.name || `Resource ${index + 1}`}`}
                      onClick={() => setActiveResourceId(resource.id)}
                    >
                      <b
                        className={RESOURCE_KIND_ABBREVIATIONS[resource.kind].length > 1 ? "wide" : undefined}
                        aria-hidden="true"
                      >
                        {RESOURCE_KIND_ABBREVIATIONS[resource.kind]}
                      </b>
                      <span>{resource.name || `Resource ${index + 1}`}</span>
                      {tabErrorCount > 0 && <i title={`${tabErrorCount} validation errors`} />}
                    </button>
                    <button
                      type="button"
                      className="resource-tab-close"
                      aria-label={`Close ${resource.name || `resource ${index + 1}`} tab`}
                      onClick={() => closeResourceTab(resource.id)}
                      disabled={resources.length === 1}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                className="resource-tab-add"
                aria-label="Add resource tab"
                title={resources.length >= 4 ? "Maximum of 4 resource tabs" : "Add resource tab"}
                onClick={addResourceTab}
                disabled={resources.length >= 4}
              >
                +
              </button>
            </div>
            <span className="resource-tab-limit">{resources.length}/4 resources</span>
          </div>

          <div className="form-content" key={activeResourceId}>
            <section className="form-section">
              <div className="section-title">
                <span className="section-number">01</span>
                <div>
                  <h3>{isStorageResource ? "Storage resource" : "Object spec"}</h3>
                  <p>Name and identify the {platform} object.</p>
                </div>
                <code>{apiVersion}</code>
              </div>
              <div className="field-grid two-col">
                <SelectField
                  label="Kind"
                  value={kind}
                  onChange={(value) => changeResourceKind(value as ResourceKind)}
                  required
                  options={[
                    { value: "Deployment", label: "Deployment" },
                    { value: "Pod", label: "Pod" },
                    { value: "Job", label: "Job" },
                    { value: "CronJob", label: "CronJob" },
                    { value: "Service", label: "Service" },
                    { value: "PersistentVolumeClaim", label: "PersistentVolumeClaim" },
                    { value: "PersistentVolume", label: "PersistentVolume" },
                    ...(platform === "OpenShift" ? [{ value: "Route", label: "Route" }] : []),
                  ]}
                />
                <Field label="Name" value={name} onChange={setName} required error={validationErrors.name} />
                {kind !== "PersistentVolume" && (
                  <Field label="Namespace" value={namespace} onChange={setNamespace} error={validationErrors.namespace} />
                )}
                {kind === "Deployment" && (
                  <Field
                    label="Replicas"
                    value={replicas}
                    onChange={setReplicas}
                    type="number"
                    error={validationErrors.replicas}
                  />
                )}
                {kind === "Pod" && (
                  <SelectField
                    label="Restart policy"
                    value={restartPolicy}
                    onChange={setRestartPolicy}
                    options={["Always", "OnFailure", "Never"].map((item) => ({ value: item, label: item }))}
                  />
                )}
                {kind === "CronJob" && (
                  <>
                    <Field
                      label="Schedule"
                      value={schedule}
                      onChange={setSchedule}
                      placeholder="*/5 * * * *"
                      required
                      error={validationErrors.schedule}
                    />
                    <SelectField
                      label="Concurrency policy"
                      value={concurrencyPolicy}
                      onChange={setConcurrencyPolicy}
                      options={["Allow", "Forbid", "Replace"].map((item) => ({ value: item, label: item }))}
                    />
                  </>
                )}
                {(kind === "Job" || kind === "CronJob") && (
                  <>
                    <Field
                      label="Completions"
                      value={completions}
                      onChange={setCompletions}
                      type="number"
                      required
                      error={validationErrors.completions}
                    />
                    <Field
                      label="Parallelism"
                      value={parallelism}
                      onChange={setParallelism}
                      type="number"
                      required
                      error={validationErrors.parallelism}
                    />
                    <Field
                      label="Backoff limit"
                      value={backoffLimit}
                      onChange={setBackoffLimit}
                      type="number"
                      required
                      error={validationErrors.backoffLimit}
                    />
                    <SelectField
                      label="Restart policy"
                      value={restartPolicy}
                      onChange={setRestartPolicy}
                      options={["Never", "OnFailure"].map((item) => ({ value: item, label: item }))}
                    />
                  </>
                )}
                {kind === "Service" && (
                  <SelectField
                    label="Service type"
                    value={serviceType}
                    onChange={setServiceType}
                    options={["ClusterIP", "NodePort", "LoadBalancer"].map((item) => ({ value: item, label: item }))}
                  />
                )}
              </div>
              <div className="labels-editor">
                <div className="labels-editor-heading">
                  <div>
                    <strong>
                      Labels{kindUsesLabels(kind) && <span className="required"> *</span>}
                    </strong>
                  </div>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() =>
                      setLabels((current) => [
                        ...current,
                        { id: Date.now(), key: "", value: "" },
                      ])
                    }
                  >
                    <span aria-hidden="true">＋</span>Add label
                  </button>
                </div>
                <div className="labels-list">
                  {labels.map((label, index) => (
                    <div className="label-row" key={label.id}>
                      <Field
                        label="Key"
                        value={label.key}
                        onChange={(value) => updateLabel(label.id, { key: value })}
                        placeholder="app"
                        required
                        error={validationErrors[`label-key-${label.id}`]}
                      />
                      <Field
                        label="Value"
                        value={label.value}
                        onChange={(value) => updateLabel(label.id, { value })}
                        placeholder="example"
                        required
                        error={validationErrors[`label-value-${label.id}`]}
                      />
                      <button
                        type="button"
                        className="remove-button"
                        aria-label={`Remove label ${index + 1}`}
                        onClick={() =>
                          setLabels((current) => current.filter((item) => item.id !== label.id))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                {validationErrors.labels && (
                  <span className="field-error">{validationErrors.labels}</span>
                )}
              </div>
            </section>

            {isStorageResource && (
              <section className="form-section">
                <div className="section-title">
                  <span className="section-number">02</span>
                  <div>
                    <h3>Storage specification</h3>
                    <p>
                      {kind === "PersistentVolumeClaim"
                        ? "Request storage with the required capacity and access modes."
                        : "Define cluster storage capacity, lifecycle, and backing source."}
                    </p>
                  </div>
                  <code>{kind === "PersistentVolumeClaim" ? "Namespaced" : "Cluster-scoped"}</code>
                </div>

                <div className="field-grid two-col">
                  <Field
                    label={kind === "PersistentVolumeClaim" ? "Storage request" : "Storage capacity"}
                    value={kind === "PersistentVolumeClaim" ? storageRequest : storageCapacity}
                    onChange={kind === "PersistentVolumeClaim" ? setStorageRequest : setStorageCapacity}
                    placeholder={kind === "PersistentVolumeClaim" ? "1Gi" : "10Gi"}
                    required
                    error={
                      kind === "PersistentVolumeClaim"
                        ? validationErrors.storageRequest
                        : validationErrors.storageCapacity
                    }
                  />
                  <Field
                    label="Storage class name"
                    value={storageClassName}
                    onChange={setStorageClassName}
                    placeholder="standard"
                    hint="Optional. Omit to use the cluster default for claims."
                    error={validationErrors.storageClassName}
                  />
                  <SelectField
                    label="Volume mode"
                    value={storageVolumeMode}
                    onChange={setStorageVolumeMode}
                    required
                    options={
                      kind === "PersistentVolume" && pvSourceType === "nfs"
                        ? [{ value: "Filesystem", label: "Filesystem" }]
                        : [
                            { value: "Filesystem", label: "Filesystem" },
                            { value: "Block", label: "Block" },
                          ]
                    }
                  />
                  {kind === "PersistentVolumeClaim" ? (
                    <Field
                      label="PersistentVolume name"
                      value={pvcVolumeName}
                      onChange={setPvcVolumeName}
                      placeholder="existing-pv"
                      hint="Optional. Bind this claim to a specific PersistentVolume."
                      error={validationErrors.pvcVolumeName}
                    />
                  ) : (
                    <SelectField
                      label="Reclaim policy"
                      value={pvReclaimPolicy}
                      onChange={setPvReclaimPolicy}
                      required
                      options={[
                        { value: "Retain", label: "Retain" },
                        { value: "Delete", label: "Delete" },
                      ]}
                    />
                  )}
                </div>

                <fieldset className="access-modes-fieldset">
                  <legend className="field-label">
                    Access modes<span className="required"> *</span>
                  </legend>
                  <div className="access-mode-options">
                    {[
                      ["ReadWriteOnce", "ReadWriteOnce (RWO)"],
                      ["ReadOnlyMany", "ReadOnlyMany (ROX)"],
                      ["ReadWriteMany", "ReadWriteMany (RWX)"],
                      ["ReadWriteOncePod", "ReadWriteOncePod (RWOP)"],
                    ].map(([value, label]) => (
                      <label className="check-field" key={value}>
                        <input
                          type="checkbox"
                          checked={storageAccessModes.includes(value)}
                          onChange={(event) => toggleStorageAccessMode(value, event.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {validationErrors.storageAccessModes && (
                    <span className="field-error">{validationErrors.storageAccessModes}</span>
                  )}
                </fieldset>

                {kind === "PersistentVolume" && (
                  <div className="storage-source-section">
                    <div className="container-subsection-title">
                      <strong>Volume source</strong>
                      <span>Select the system that provides the underlying storage.</span>
                    </div>
                    <SelectField
                      label="Source type"
                      value={pvSourceType}
                      onChange={(value) => changePvSourceType(value as PvSourceType)}
                      required
                      options={[
                        { value: "hostPath", label: "hostPath" },
                        { value: "nfs", label: "NFS" },
                        { value: "csi", label: "CSI" },
                      ]}
                    />

                    {pvSourceType === "hostPath" && (
                      <div className="field-grid two-col">
                        <Field
                          label="Host path"
                          value={pvHostPath}
                          onChange={setPvHostPath}
                          placeholder="/mnt/data"
                          required
                          error={validationErrors.pvHostPath}
                        />
                        <SelectField
                          label="Host path type"
                          value={pvHostPathType}
                          onChange={setPvHostPathType}
                          options={[
                            "DirectoryOrCreate",
                            "Directory",
                            "FileOrCreate",
                            "File",
                            "Socket",
                            "CharDevice",
                            "BlockDevice",
                          ].map((item) => ({ value: item, label: item }))}
                        />
                      </div>
                    )}

                    {pvSourceType === "nfs" && (
                      <>
                        <div className="field-grid two-col">
                          <Field
                            label="NFS server"
                            value={pvNfsServer}
                            onChange={setPvNfsServer}
                            placeholder="nfs.example.com"
                            required
                            error={validationErrors.pvNfsServer}
                          />
                          <Field
                            label="NFS export path"
                            value={pvNfsPath}
                            onChange={setPvNfsPath}
                            placeholder="/exports/data"
                            required
                            error={validationErrors.pvNfsPath}
                          />
                        </div>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={pvNfsReadOnly}
                            onChange={(event) => setPvNfsReadOnly(event.target.checked)}
                          />
                          Read-only NFS source
                        </label>
                      </>
                    )}

                    {pvSourceType === "csi" && (
                      <div className="field-grid two-col">
                        <Field
                          label="CSI driver"
                          value={pvCsiDriver}
                          onChange={setPvCsiDriver}
                          placeholder="driver.example.com"
                          required
                          error={validationErrors.pvCsiDriver}
                        />
                        <Field
                          label="Volume handle"
                          value={pvCsiVolumeHandle}
                          onChange={setPvCsiVolumeHandle}
                          placeholder="volume-id"
                          required
                          error={validationErrors.pvCsiVolumeHandle}
                        />
                        {storageVolumeMode === "Filesystem" && (
                          <Field
                            label="Filesystem type"
                            value={pvCsiFsType}
                            onChange={setPvCsiFsType}
                            placeholder="ext4"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {kind === "Route" && (
              <section className="form-section">
                <div className="section-title">
                  <span className="section-number">02</span>
                  <div>
                    <h3>Route</h3>
                    <p>Expose an OpenShift Service through the cluster router.</p>
                  </div>
                  <code>OpenShift only</code>
                </div>
                <div className="field-grid two-col">
                  <Field
                    label="Service name"
                    value={routeServiceName}
                    onChange={setRouteServiceName}
                    required
                    error={validationErrors.routeServiceName}
                  />
                  <Field
                    label="Target port"
                    value={routeTargetPort}
                    onChange={setRouteTargetPort}
                    placeholder="http or 8080"
                    hint="Named Service port or port number."
                    error={validationErrors.routeTargetPort}
                  />
                  <Field
                    label="Hostname"
                    value={routeHost}
                    onChange={setRouteHost}
                    placeholder="app.example.com"
                    hint="Optional. OpenShift can generate a hostname when empty."
                    error={validationErrors.routeHost}
                  />
                  <Field
                    label="Path"
                    value={routePath}
                    onChange={setRoutePath}
                    placeholder="/"
                    hint="Optional URL path prefix."
                    error={validationErrors.routePath}
                  />
                </div>

                <label className="check-field route-tls-toggle">
                  <input
                    type="checkbox"
                    checked={routeTlsEnabled}
                    onChange={(event) => setRouteTlsEnabled(event.target.checked)}
                  />
                  Enable TLS
                </label>

                {routeTlsEnabled && (
                  <div className="field-grid two-col route-tls-fields">
                    <SelectField
                      label="TLS termination"
                      value={routeTlsTermination}
                      onChange={changeRouteTlsTermination}
                      options={[
                        { value: "edge", label: "Edge" },
                        { value: "reencrypt", label: "Re-encrypt" },
                        { value: "passthrough", label: "Passthrough" },
                      ]}
                    />
                    <SelectField
                      label="Insecure traffic policy"
                      value={routeInsecurePolicy}
                      onChange={setRouteInsecurePolicy}
                      options={[
                        { value: "None", label: "None" },
                        ...(routeTlsTermination === "passthrough"
                          ? []
                          : [{ value: "Allow", label: "Allow" }]),
                        { value: "Redirect", label: "Redirect" },
                      ]}
                    />
                  </div>
                )}
              </section>
            )}

            {hasPodSpec && (
              <section className="form-section">
                <div className="section-title with-action">
                  <span className="section-number">02</span>
                  <div><h3>Container</h3><p>Add one or more containers to the pod specification.</p></div>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() => {
                      const containerId = Date.now();
                      setContainers((current) => [
                        ...current,
                        {
                          id: containerId,
                          name: `container-${current.length + 1}`,
                          image: "nginx:latest",
                          pullPolicy: "IfNotPresent",
                          ports: [],
                          resourcesEnabled: false,
                          cpuRequest: "250m",
                          memoryRequest: "256Mi",
                          cpuLimit: "500m",
                          memoryLimit: "512Mi",
                        },
                      ]);
                    }}
                  >
                    <span aria-hidden="true">＋</span>Add container
                  </button>
                </div>

                <div className="container-list">
                  {containers.map((container, containerIndex) => (
                    <div className="container-card" key={container.id}>
                      <div className="container-card-head">
                        <span>CONTAINER {String(containerIndex + 1).padStart(2, "0")}</span>
                        <button
                          type="button"
                          onClick={() => removeContainer(container.id)}
                          disabled={containers.length === 1}
                        >
                          Remove
                        </button>
                      </div>

                      <div className="field-grid two-col">
                        <Field
                          label="Container name"
                          value={container.name}
                          onChange={(value) => updateContainer(container.id, { name: value })}
                          required
                          error={validationErrors[`container-name-${container.id}`]}
                        />
                        <SelectField
                          label="Image pull policy"
                          value={container.pullPolicy}
                          onChange={(value) => updateContainer(container.id, { pullPolicy: value })}
                          options={["IfNotPresent", "Always", "Never"].map((item) => ({ value: item, label: item }))}
                        />
                      </div>
                      <Field
                        label="Container image"
                        value={container.image}
                        onChange={(value) => updateContainer(container.id, { image: value })}
                        required
                        error={validationErrors[`container-image-${container.id}`]}
                      />

                      <div className="container-actions">
                        <button
                          className="text-action"
                          type="button"
                          onClick={() =>
                            updateContainer(container.id, {
                              ports: [
                                ...container.ports,
                                createDefaultPort(container.ports.length),
                              ],
                            })
                          }
                        >
                          <span aria-hidden="true">＋</span>Add container port
                        </button>
                        <button
                          className="text-action"
                          type="button"
                          onClick={() =>
                            updateContainer(container.id, {
                              resourcesEnabled: !container.resourcesEnabled,
                            })
                          }
                        >
                          <span aria-hidden="true">{container.resourcesEnabled ? "−" : "＋"}</span>
                          {container.resourcesEnabled ? "Remove container resources" : "Add container resources"}
                        </button>
                      </div>

                      {container.ports.length > 0 && (
                      <div className="container-subsection">
                        <div className="container-subsection-title">
                          <strong>Container ports</strong>
                          <span>{container.ports.length} configured</span>
                        </div>
                        <div className="repeat-list">
                          {container.ports.map((port, portIndex) => (
                            <div className="repeat-row container-port-row" key={port.id}>
                              <Field
                                label="Name"
                                value={port.name}
                                onChange={(value) => updateContainerPort(container.id, port.id, { name: value })}
                                error={validationErrors[`container-port-name-${container.id}-${port.id}`]}
                              />
                              <Field
                                label="Container port"
                                value={port.port}
                                onChange={(value) => updateContainerPort(container.id, port.id, { port: value })}
                                type="number"
                                required
                                error={validationErrors[`container-port-${container.id}-${port.id}`]}
                              />
                              <SelectField
                                label="Protocol"
                                value={port.protocol}
                                onChange={(value) =>
                                  updateContainerPort(container.id, port.id, { protocol: value as Protocol })
                                }
                                options={["TCP", "UDP", "SCTP"].map((item) => ({ value: item, label: item }))}
                              />
                              <button
                                type="button"
                                className="remove-button"
                                aria-label={`Remove container port ${portIndex + 1}`}
                                onClick={() =>
                                  updateContainer(container.id, {
                                    ports: container.ports.filter((item) => item.id !== port.id),
                                  })
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      )}

                      {container.resourcesEnabled && (
                        <div className="container-subsection">
                          <div className="container-subsection-title">
                            <strong>Container resources</strong>
                            <span>Requests and limits</span>
                          </div>
                          <div className="resource-grid">
                            <Field
                              label="CPU request"
                              value={container.cpuRequest}
                              onChange={(value) => updateContainer(container.id, { cpuRequest: value })}
                              placeholder="250m"
                            />
                            <Field
                              label="Memory request"
                              value={container.memoryRequest}
                              onChange={(value) => updateContainer(container.id, { memoryRequest: value })}
                              placeholder="256Mi"
                            />
                            <Field
                              label="CPU limit"
                              value={container.cpuLimit}
                              onChange={(value) => updateContainer(container.id, { cpuLimit: value })}
                              placeholder="500m"
                            />
                            <Field
                              label="Memory limit"
                              value={container.memoryLimit}
                              onChange={(value) => updateContainer(container.id, { memoryLimit: value })}
                              placeholder="512Mi"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

              </section>
            )}

            {kind === "Service" && (
            <section className="form-section">
              <div className="section-title with-action">
                <span className="section-number">02</span>
                <div>
                  <h3>Service ports</h3>
                  <p>Expose named endpoints with an explicit protocol.</p>
                </div>
                <button
                  className="text-action"
                  type="button"
                  onClick={() =>
                    setServicePorts((current) => [
                      ...current,
                      createDefaultPort(current.length),
                    ])
                  }
                >
                  <span aria-hidden="true">＋</span>Add service port
                </button>
              </div>

              <div className="repeat-list">
                {servicePorts.map((port, index) => (
                  <div className="repeat-row service-port-row" key={port.id}>
                    <Field
                      label="Name"
                      value={port.name}
                      onChange={(value) => updateServicePort(port.id, { name: value })}
                      error={validationErrors[`service-port-name-${port.id}`]}
                    />
                    <Field
                      label="Service port"
                      value={port.port}
                      onChange={(value) => updateServicePort(port.id, { port: value })}
                      type="number"
                      required
                      error={validationErrors[`service-port-${port.id}`]}
                    />
                    <Field
                      label="Target port"
                      value={port.targetPort}
                      onChange={(value) => updateServicePort(port.id, { targetPort: value })}
                      type="number"
                      error={validationErrors[`service-target-port-${port.id}`]}
                    />
                    <SelectField
                      label="Protocol"
                      value={port.protocol}
                      onChange={(value) => updateServicePort(port.id, { protocol: value as Protocol })}
                      options={["TCP", "UDP", "SCTP"].map((item) => ({ value: item, label: item }))}
                    />
                    <button
                      type="button"
                      className="remove-button"
                      aria-label={`Remove port ${index + 1}`}
                      onClick={() => setServicePorts((current) => current.filter((item) => item.id !== port.id))}
                      disabled={servicePorts.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>
            )}

            {hasPodSpec && (
              <section className="form-section">
                <div className="section-title with-action">
                  <span className="section-number">03</span>
                  <div><h3>Volumes</h3><p>Attach storage and configuration to selected containers.</p></div>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() =>
                      setVolumes((current) => [
                        ...current,
                        {
                          id: Date.now(),
                          name: "",
                          type: "persistentVolumeClaim",
                          source: "",
                          readOnly: false,
                          mountPoints: [
                            {
                              id: Date.now() + 1,
                              containerId: containers[0]?.id ?? 0,
                              mountPath: "/mnt",
                            },
                          ],
                        },
                      ])
                    }
                  >
                    <span aria-hidden="true">＋</span>Add volume
                  </button>
                </div>

                <div className="repeat-list">
                  {volumes.map((volume, index) => (
                    <div className="volume-card" key={volume.id}>
                      <div className="volume-card-head">
                        <span>VOLUME {String(index + 1).padStart(2, "0")}</span>
                        <button
                          type="button"
                          onClick={() => setVolumes((current) => current.filter((item) => item.id !== volume.id))}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="field-grid two-col">
                        <Field
                          label="Volume name"
                          value={volume.name}
                          onChange={(value) => updateVolume(volume.id, { name: value })}
                          required
                          error={validationErrors[`volume-name-${volume.id}`]}
                        />
                        <SelectField
                          label="Volume type"
                          value={volume.type}
                          onChange={(value) => updateVolume(volume.id, { type: value as VolumeType, source: "" })}
                          required
                          options={[
                            { value: "emptyDir", label: "emptyDir" },
                            { value: "configMap", label: "ConfigMap" },
                            { value: "secret", label: "Secret" },
                            { value: "persistentVolumeClaim", label: "PersistentVolumeClaim" },
                          ]}
                        />
                        <Field
                          label={volume.type === "emptyDir" ? "Size limit" : "Source name"}
                          value={volume.source}
                          onChange={(value) => updateVolume(volume.id, { source: value })}
                          placeholder={getVolumeSourcePlaceholder(volume.type)}
                          required={volume.type !== "emptyDir"}
                          error={validationErrors[`volume-source-${volume.id}`]}
                        />
                      </div>

                      <div className="mount-points-section">
                        <div className="mount-points-heading">
                          <div>
                            <strong>Mount points</strong>
                            <span>Choose where this volume is mounted in each container.</span>
                          </div>
                          <button
                            className="text-action"
                            type="button"
                            onClick={() => {
                              const nextContainer =
                                containers.find(
                                  (container) =>
                                    !volume.mountPoints.some(
                                      (mountPoint) => mountPoint.containerId === container.id,
                                    ),
                                ) ?? containers[0];
                              updateVolume(volume.id, {
                                mountPoints: [
                                  ...volume.mountPoints,
                                  {
                                    id: Date.now(),
                                    containerId: nextContainer?.id ?? 0,
                                    mountPath: "/mnt",
                                  },
                                ],
                              });
                            }}
                          >
                            <span aria-hidden="true">＋</span>Add mount point
                          </button>
                        </div>

                        <div className="mount-point-list">
                          {volume.mountPoints.map((mountPoint, mountPointIndex) => (
                            <div className="mount-point-row" key={mountPoint.id}>
                              <SelectField
                                label="Container name"
                                value={String(mountPoint.containerId)}
                                onChange={(value) =>
                                  updateMountPoint(volume.id, mountPoint.id, {
                                    containerId: Number(value),
                                  })
                                }
                                options={containers.map((container, containerIndex) => ({
                                  value: String(container.id),
                                  label: container.name || `Container ${containerIndex + 1}`,
                                }))}
                                required
                              />
                              <Field
                                label="Mount path inside container"
                                value={mountPoint.mountPath}
                                onChange={(value) =>
                                  updateMountPoint(volume.id, mountPoint.id, { mountPath: value })
                                }
                                required
                                error={validationErrors[`mount-path-${volume.id}-${mountPoint.id}`]}
                              />
                              <button
                                type="button"
                                className="remove-button"
                                aria-label={`Remove mount point ${mountPointIndex + 1}`}
                                onClick={() =>
                                  updateVolume(volume.id, {
                                    mountPoints: volume.mountPoints.filter(
                                      (item) => item.id !== mountPoint.id,
                                    ),
                                  })
                                }
                                disabled={volume.mountPoints.length === 1}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>

                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={volume.readOnly}
                          onChange={(event) => updateVolume(volume.id, { readOnly: event.target.checked })}
                        />
                        Read-only
                      </label>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {hasPodSpec && (
              <section className="form-section collapsible-form-section">
                <details
                  className="security-section"
                  open={securityExpanded}
                  onToggle={(event) => setSecurityExpanded(event.currentTarget.open)}
                >
                  <summary>
                    <span className="section-number">04</span>
                    <div>
                      <h3>Security</h3>
                      <p>Configure pod-level identity and security settings.</p>
                    </div>
                    <span className="disclosure-icon" aria-hidden="true">⌄</span>
                  </summary>
                  <div className="security-content">
                    <Field
                      label="Service account name"
                      value={serviceAccount}
                      onChange={setServiceAccount}
                      hint="Must exist in the selected namespace."
                      error={validationErrors["service-account"]}
                    />
                  </div>
                </details>
              </section>
            )}

            <aside className="schema-note">
              <div className="schema-icon" aria-hidden="true">API</div>
              <div>
                <strong>{platform} v{version} field map</strong>
                <p>
                  This builder uses a bundled schema subset, so it works without a server or cluster credentials.
                  Full cluster-specific validation can later load OpenAPI v3 from the cluster API server.
                </p>
              </div>
              <a
                href={
                  platform === "OpenShift"
                    ? `https://docs.redhat.com/en/documentation/openshift_container_platform/${version}/html/api_overview/api-index`
                    : `https://kubernetes.io/docs/reference/generated/kubernetes-api/v${version}/`
                }
                target="_blank"
                rel="noreferrer"
              >
                API reference ↗
              </a>
            </aside>
          </div>
        </div>

        <aside className="yaml-panel">
          <div className="yaml-toolbar">
            <div className="file-tab">
              <span className="file-dot" />
              {manifestFileName}
            </div>
            <div className="yaml-actions">
              <button type="button" onClick={downloadManifest} disabled={!isManifestValid}>Download</button>
              <button type="button" className="copy-button" onClick={copyManifest} disabled={!isManifestValid}>
                {copied ? "Copied!" : "Copy YAML"}
              </button>
            </div>
          </div>
          <div className="editor-meta">
            <div className={isManifestValid ? "" : "invalid-state"}>
              <span className={isManifestValid ? "valid-dot" : "invalid-dot"} />
              {isManifestValid
                ? `${platform} validation passed`
                : `${validationErrorCount} validation ${validationErrorCount === 1 ? "error" : "errors"}`}
            </div>
            <span>{resources.length} {resources.length === 1 ? "resource" : "resources"} · {platform} v{version}</span>
          </div>
          <div className="code-editor" aria-label={`Generated ${platform} YAML`}>
            <div className="line-numbers" aria-hidden="true">
              {manifestLines.map((_, index) => <span key={index}>{index + 1}</span>)}
            </div>
            <pre><code>{manifest}</code></pre>
          </div>
          <div className="editor-footer">
            <span>YAML</span>
            <span>{manifestLines.length - 1} lines</span>
            <span>Spaces: 2</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
