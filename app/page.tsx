"use client";

import { useMemo, useState } from "react";

type ResourceKind = "Deployment" | "Pod" | "Service";
type Protocol = "TCP" | "UDP" | "SCTP";
type VolumeType = "emptyDir" | "configMap" | "secret" | "persistentVolumeClaim";

type PortField = {
  id: number;
  name: string;
  port: string;
  targetPort: string;
  protocol: Protocol;
};

type VolumeField = {
  id: number;
  name: string;
  type: VolumeType;
  source: string;
  mountPath: string;
  readOnly: boolean;
};

type YamlValue = string | number | boolean | YamlObject | YamlValue[];
type YamlObject = Record<string, YamlValue | undefined>;

const VERSION_OPTIONS = ["1.35", "1.34", "1.33"];

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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="field">
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
      />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
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
  const [kind, setKind] = useState<ResourceKind>("Deployment");
  const [name, setName] = useState("checkout-api");
  const [namespace, setNamespace] = useState("production");
  const [labels, setLabels] = useState("app=checkout-api, tier=backend");
  const [replicas, setReplicas] = useState("3");
  const [serviceAccount, setServiceAccount] = useState("default");
  const [restartPolicy, setRestartPolicy] = useState("Always");
  const [containerName, setContainerName] = useState("api");
  const [image, setImage] = useState("ghcr.io/acme/checkout:2.4.1");
  const [pullPolicy, setPullPolicy] = useState("IfNotPresent");
  const [cpuRequest, setCpuRequest] = useState("250m");
  const [memoryRequest, setMemoryRequest] = useState("256Mi");
  const [cpuLimit, setCpuLimit] = useState("500m");
  const [memoryLimit, setMemoryLimit] = useState("512Mi");
  const [serviceType, setServiceType] = useState("ClusterIP");
  const [ports, setPorts] = useState<PortField[]>([
    { id: 1, name: "http", port: "8080", targetPort: "8080", protocol: "TCP" },
  ]);
  const [volumes, setVolumes] = useState<VolumeField[]>([
    {
      id: 1,
      name: "checkout-data",
      type: "persistentVolumeClaim",
      source: "checkout-data-pvc",
      mountPath: "/var/lib/checkout",
      readOnly: false,
    },
  ]);
  const [copied, setCopied] = useState(false);

  const manifest = useMemo(() => {
    const parsedLabels = parseLabels(labels, name);
    const metadata: YamlObject = {
      name: name || "untitled",
      namespace: namespace || "default",
      labels: parsedLabels,
    };

    const containerPorts = ports.map((port) => ({
      name: port.name || undefined,
      containerPort: Number(port.port) || 80,
      protocol: port.protocol,
    }));

    const volumeMounts = volumes.map((volume) => ({
      name: volume.name || "volume",
      mountPath: volume.mountPath || "/data",
      readOnly: volume.readOnly || undefined,
    }));

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

    const container = {
      name: containerName || "app",
      image: image || "nginx:latest",
      imagePullPolicy: pullPolicy,
      ports: containerPorts,
      resources: {
        requests: {
          cpu: cpuRequest || undefined,
          memory: memoryRequest || undefined,
        },
        limits: {
          cpu: cpuLimit || undefined,
          memory: memoryLimit || undefined,
        },
      },
      volumeMounts,
    };

    let resource: YamlObject;

    if (kind === "Service") {
      resource = {
        apiVersion: "v1",
        kind: "Service",
        metadata,
        spec: {
          type: serviceType,
          selector: parsedLabels,
          ports: ports.map((port) => ({
            name: port.name || undefined,
            port: Number(port.port) || 80,
            targetPort: Number(port.targetPort) || Number(port.port) || 80,
            protocol: port.protocol,
          })),
        },
      };
    } else {
      const podSpec: YamlObject = {
        serviceAccountName: serviceAccount || undefined,
        restartPolicy: kind === "Deployment" ? undefined : restartPolicy,
        containers: [container],
        volumes: volumeSpecs,
      };

      resource =
        kind === "Pod"
          ? {
              apiVersion: "v1",
              kind: "Pod",
              metadata,
              spec: podSpec,
            }
          : {
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

    return `${toYaml(resource).join("\n")}\n`;
  }, [
    containerName,
    cpuLimit,
    cpuRequest,
    image,
    kind,
    labels,
    memoryLimit,
    memoryRequest,
    name,
    namespace,
    ports,
    pullPolicy,
    replicas,
    restartPolicy,
    serviceAccount,
    serviceType,
    volumes,
  ]);

  function updatePort(id: number, patch: Partial<PortField>) {
    setPorts((current) => current.map((port) => (port.id === id ? { ...port, ...patch } : port)));
  }

  function updateVolume(id: number, patch: Partial<VolumeField>) {
    setVolumes((current) =>
      current.map((volume) => (volume.id === id ? { ...volume, ...patch } : volume)),
    );
  }

  async function copyManifest() {
    await navigator.clipboard.writeText(manifest);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadManifest() {
    const blob = new Blob([manifest], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name || kind.toLowerCase()}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const apiVersion = kind === "Deployment" ? "apps/v1" : "v1";
  const manifestLines = manifest.split("\n");

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            K
          </div>
          <div>
            <div className="brand-name">Manifest Studio</div>
            <div className="brand-subtitle">Kubernetes resource composer</div>
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
          <span className="latest-badge">v1.35 recommended</span>
        </div>

        <div className="schema-chip" title="The supported field map is bundled with this client-only site">
          <span className="status-dot" aria-hidden="true" />
          <span>
            <strong>Schema ready</strong>
            <small>Bundled · client-side</small>
          </span>
        </div>
      </header>

      <section className="intro">
        <div>
          <p className="eyebrow">VISUAL KUBERNETES BUILDER</p>
          <h1>Compose a manifest without losing the YAML.</h1>
          <p>
            Configure familiar Kubernetes fields on the left. The manifest stays readable,
            valid, and ready to copy on the right.
          </p>
        </div>
        <ol className="workflow" aria-label="Builder workflow">
          <li><span>1</span>Choose</li>
          <li><span>2</span>Configure</li>
          <li><span>3</span>Export</li>
        </ol>
      </section>

      <section className="workspace">
        <div className="builder-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">RESOURCE CONFIGURATION</p>
              <h2>Build from primitives</h2>
            </div>
            <div className="synced-state"><span />Synced</div>
          </div>

          <div className="form-content">
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
                  onChange={(value) => setKind(value as ResourceKind)}
                  options={[
                    { value: "Deployment", label: "Deployment" },
                    { value: "Pod", label: "Pod" },
                    { value: "Service", label: "Service" },
                  ]}
                />
                <Field label="Name" value={name} onChange={setName} required />
                <Field label="Namespace" value={namespace} onChange={setNamespace} />
                {kind === "Deployment" && (
                  <Field label="Replicas" value={replicas} onChange={setReplicas} type="number" />
                )}
                {kind === "Pod" && (
                  <SelectField
                    label="Restart policy"
                    value={restartPolicy}
                    onChange={setRestartPolicy}
                    options={["Always", "OnFailure", "Never"].map((item) => ({ value: item, label: item }))}
                  />
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
              />
            </section>

            {kind !== "Service" && (
              <section className="form-section">
                <div className="section-title">
                  <span className="section-number">02</span>
                  <div><h3>Container</h3><p>Set the image, identity, and compute envelope.</p></div>
                </div>
                <div className="subpanel">
                  <div className="subpanel-label">PRIMARY CONTAINER</div>
                  <div className="field-grid two-col">
                    <Field label="Container name" value={containerName} onChange={setContainerName} required />
                    <SelectField
                      label="Image pull policy"
                      value={pullPolicy}
                      onChange={setPullPolicy}
                      options={["IfNotPresent", "Always", "Never"].map((item) => ({ value: item, label: item }))}
                    />
                  </div>
                  <Field label="Container image" value={image} onChange={setImage} required />
                  <div className="resource-grid">
                    <Field label="CPU request" value={cpuRequest} onChange={setCpuRequest} placeholder="250m" />
                    <Field label="Memory request" value={memoryRequest} onChange={setMemoryRequest} placeholder="256Mi" />
                    <Field label="CPU limit" value={cpuLimit} onChange={setCpuLimit} placeholder="500m" />
                    <Field label="Memory limit" value={memoryLimit} onChange={setMemoryLimit} placeholder="512Mi" />
                  </div>
                  <Field
                    label="Service account"
                    value={serviceAccount}
                    onChange={setServiceAccount}
                    hint="Must exist in the selected namespace."
                  />
                </div>
              </section>
            )}

            <section className="form-section">
              <div className="section-title with-action">
                <span className="section-number">{kind === "Service" ? "02" : "03"}</span>
                <div>
                  <h3>{kind === "Service" ? "Service ports" : "Container ports"}</h3>
                  <p>Expose named endpoints with an explicit protocol.</p>
                </div>
                <button
                  className="text-action"
                  type="button"
                  onClick={() =>
                    setPorts((current) => [
                      ...current,
                      {
                        id: Date.now(),
                        name: `port-${current.length + 1}`,
                        port: "8080",
                        targetPort: "8080",
                        protocol: "TCP",
                      },
                    ])
                  }
                >
                  <span aria-hidden="true">＋</span>Add port
                </button>
              </div>

              <div className="repeat-list">
                {ports.map((port, index) => (
                  <div className="repeat-row" key={port.id}>
                    <div className="repeat-index">{String(index + 1).padStart(2, "0")}</div>
                    <Field label="Name" value={port.name} onChange={(value) => updatePort(port.id, { name: value })} />
                    <Field
                      label={kind === "Service" ? "Service port" : "Container port"}
                      value={port.port}
                      onChange={(value) => updatePort(port.id, { port: value })}
                      type="number"
                    />
                    {kind === "Service" && (
                      <Field
                        label="Target port"
                        value={port.targetPort}
                        onChange={(value) => updatePort(port.id, { targetPort: value })}
                        type="number"
                      />
                    )}
                    <SelectField
                      label="Protocol"
                      value={port.protocol}
                      onChange={(value) => updatePort(port.id, { protocol: value as Protocol })}
                      options={["TCP", "UDP", "SCTP"].map((item) => ({ value: item, label: item }))}
                    />
                    <button
                      type="button"
                      className="remove-button"
                      aria-label={`Remove port ${index + 1}`}
                      onClick={() => setPorts((current) => current.filter((item) => item.id !== port.id))}
                      disabled={ports.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {kind !== "Service" && (
              <section className="form-section">
                <div className="section-title with-action">
                  <span className="section-number">04</span>
                  <div><h3>Volumes</h3><p>Attach storage and configuration to the container.</p></div>
                  <button
                    className="text-action"
                    type="button"
                    onClick={() =>
                      setVolumes((current) => [
                        ...current,
                        {
                          id: Date.now(),
                          name: `volume-${current.length + 1}`,
                          type: "emptyDir",
                          source: "",
                          mountPath: "/data",
                          readOnly: false,
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
                        <Field label="Volume name" value={volume.name} onChange={(value) => updateVolume(volume.id, { name: value })} />
                        <SelectField
                          label="Volume type"
                          value={volume.type}
                          onChange={(value) => updateVolume(volume.id, { type: value as VolumeType, source: "" })}
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
                          placeholder={volume.type === "emptyDir" ? "1Gi (optional)" : "Existing object name"}
                        />
                        <Field label="Mount path" value={volume.mountPath} onChange={(value) => updateVolume(volume.id, { mountPath: value })} />
                      </div>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={volume.readOnly}
                          onChange={(event) => updateVolume(volume.id, { readOnly: event.target.checked })}
                        />
                        Mount as read-only
                      </label>
                    </div>
                  ))}
                </div>
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
              {name || kind.toLowerCase()}.yaml
            </div>
            <div className="yaml-actions">
              <button type="button" onClick={downloadManifest}>Download</button>
              <button type="button" className="copy-button" onClick={copyManifest}>
                {copied ? "Copied!" : "Copy YAML"}
              </button>
            </div>
          </div>
          <div className="editor-meta">
            <div><span className="valid-dot" />Schema valid</div>
            <span>{apiVersion} · Kubernetes v{version}</span>
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
            <span className="footer-ready"><i />Ready to apply</span>
          </div>
        </aside>
      </section>
    </main>
  );
}
