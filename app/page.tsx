"use client";

import { useMemo, useRef, useState, type SetStateAction } from "react";
import { validateManifestFields } from "./validation";

type ResourceKind = "Deployment" | "Pod" | "Service" | "Job" | "CronJob";
type Protocol = "TCP" | "UDP" | "SCTP";
type VolumeType = "emptyDir" | "configMap" | "secret" | "persistentVolumeClaim";

type PortField = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
  protocol: Protocol;
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
  labels: string;
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
  containers: ContainerField[];
  servicePorts: PortField[];
  volumes: VolumeField[];
};

type YamlValue = string | number | boolean | YamlObject | YamlValue[];
interface YamlObject {
  [key: string]: YamlValue | undefined;
}

const VERSION_OPTIONS = ["1.35", "1.34", "1.33"];

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

function parseLabels(value: string, fallbackName: string) {
  const labels = Object.fromEntries(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.includes("=") ? "=" : ":";
        const [key, ...rest] = entry.split(separator);
        return [key.trim(), rest.join(separator).trim() || "true"];
      })
      .filter(([key]) => Boolean(key)),
  );

  return Object.keys(labels).length > 0 ? labels : { app: fallbackName || "app" };
}

function createDefaultResource(id: number): ResourceState {
  return {
    id,
    kind: "Deployment",
    name: "example",
    namespace: "production",
    labels: "app=example",
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
    schedule,
    securityExpanded,
    serviceAccount,
    servicePorts,
    serviceType,
    parallelism,
    volumes,
  } = resourceState;
  const parsedLabels = parseLabels(labels, name);
  const metadata: YamlObject = {
    name: name || "untitled",
    namespace: namespace || "default",
    labels: parsedLabels,
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

  if (kind === "Service") {
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
        metadata: { labels: parsedLabels },
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
  const [version, setVersion] = useState("1.35");
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
    schedule,
    securityExpanded,
    serviceAccount,
    servicePorts,
    serviceType,
    parallelism,
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
  const setLabels = (value: SetStateAction<string>) => setResourceField("labels", value);
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
  const setContainers = (value: SetStateAction<ContainerField[]>) => setResourceField("containers", value);
  const setServicePorts = (value: SetStateAction<PortField[]>) => setResourceField("servicePorts", value);
  const setVolumes = (value: SetStateAction<VolumeField[]>) => setResourceField("volumes", value);

  function changeResourceKind(nextKind: ResourceKind) {
    setResources((current) =>
      current.map((resource) =>
        resource.id === activeResourceId
          ? {
              ...resource,
              kind: nextKind,
              restartPolicy:
                (nextKind === "Job" || nextKind === "CronJob") && resource.restartPolicy === "Always"
                  ? "Never"
                  : resource.restartPolicy,
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
    link.download = resources.length > 1 ? "kubernetes-resources.yaml" : `${name || kind.toLowerCase()}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const apiVersion =
    kind === "Deployment" ? "apps/v1" : kind === "Job" || kind === "CronJob" ? "batch/v1" : "v1";
  const manifestFileName = resources.length > 1 ? "kubernetes-resources.yaml" : `${name || kind.toLowerCase()}.yaml`;
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
            <div className="brand-tagline">Visual Kubernetes YAML builder</div>
          </div>
        </div>

        <div className="version-picker">
          <label htmlFor="kubernetes-version">Kubernetes version</label>
          <select
            id="kubernetes-version"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
          >
            {VERSION_OPTIONS.map((item) => (
              <option key={item} value={item}>
                v{item}
              </option>
            ))}
          </select>
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

          <div className="resource-tabs" aria-label="Kubernetes resources">
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
                      <b aria-hidden="true">{resource.kind}</b>
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
                <div><h3>Workload</h3><p>Name and identify the Kubernetes object.</p></div>
                <code>{apiVersion}</code>
              </div>
              <div className="field-grid two-col">
                <SelectField
                  label="Object type"
                  value={kind}
                  onChange={(value) => changeResourceKind(value as ResourceKind)}
                  required
                  options={[
                    { value: "Deployment", label: "Deployment" },
                    { value: "Pod", label: "Pod" },
                    { value: "Job", label: "Job" },
                    { value: "CronJob", label: "CronJob" },
                    { value: "Service", label: "Service" },
                  ]}
                />
                <Field label="Name" value={name} onChange={setName} required error={validationErrors.name} />
                <Field label="Namespace" value={namespace} onChange={setNamespace} error={validationErrors.namespace} />
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
              <Field
                label="Labels"
                value={labels}
                onChange={setLabels}
                hint="Comma-separated key=value pairs. Used as selectors for Deployments and Services."
                error={validationErrors.labels}
              />
            </section>

            {kind !== "Service" && (
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

            {kind !== "Service" && (
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

            {kind !== "Service" && (
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
                <strong>Kubernetes v{version} field map</strong>
                <p>
                  This builder uses a bundled schema subset, so it works without a server or cluster credentials.
                  Full cluster-specific validation can later load OpenAPI v3 from a Kubernetes API server.
                </p>
              </div>
              <a
                href={`https://kubernetes.io/docs/reference/generated/kubernetes-api/v${version}/`}
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
                ? "Kubernetes validation passed"
                : `${validationErrorCount} validation ${validationErrorCount === 1 ? "error" : "errors"}`}
            </div>
            <span>{resources.length} {resources.length === 1 ? "resource" : "resources"} · Kubernetes v{version}</span>
          </div>
          <div className="code-editor" aria-label="Generated Kubernetes YAML">
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
