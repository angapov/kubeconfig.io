import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import Ajv from "ajv";

const schemaRoot = path.join(process.cwd(), "public", "schemas");
const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  validateFormats: false,
});

const podSpec = {
  restartPolicy: "Always",
  containers: [
    {
      name: "container-1",
      image: "nginx:latest",
      imagePullPolicy: "IfNotPresent",
    },
  ],
};

const examples = {
  Pod: {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "example", labels: { app: "example" } },
    spec: podSpec,
  },
  Deployment: {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "example", labels: { app: "example" } },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: "example" } },
      template: {
        metadata: { labels: { app: "example" } },
        spec: podSpec,
      },
    },
  },
  Service: {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "example", labels: { app: "example" } },
    spec: {
      type: "ClusterIP",
      selector: { app: "example" },
      ports: [{ name: "http", port: 80, targetPort: 80, protocol: "TCP" }],
    },
  },
  Job: {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "example" },
    spec: {
      completions: 1,
      parallelism: 1,
      backoffLimit: 6,
      template: { spec: { ...podSpec, restartPolicy: "Never" } },
    },
  },
  CronJob: {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: "example" },
    spec: {
      schedule: "*/5 * * * *",
      concurrencyPolicy: "Allow",
      jobTemplate: {
        spec: {
          completions: 1,
          parallelism: 1,
          backoffLimit: 6,
          template: { spec: { ...podSpec, restartPolicy: "Never" } },
        },
      },
    },
  },
  PersistentVolumeClaim: {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: "example" },
    spec: {
      accessModes: ["ReadWriteOnce"],
      volumeMode: "Filesystem",
      resources: { requests: { storage: "1Gi" } },
    },
  },
  PersistentVolume: {
    apiVersion: "v1",
    kind: "PersistentVolume",
    metadata: { name: "example" },
    spec: {
      capacity: { storage: "10Gi" },
      accessModes: ["ReadWriteOnce"],
      volumeMode: "Filesystem",
      persistentVolumeReclaimPolicy: "Retain",
      hostPath: { path: "/mnt/data", type: "DirectoryOrCreate" },
    },
  },
  Route: {
    apiVersion: "route.openshift.io/v1",
    kind: "Route",
    metadata: { name: "example" },
    spec: { to: { kind: "Service", name: "example" }, port: { targetPort: "http" } },
  },
};

function normalizeKubernetesSchema(value) {
  if (Array.isArray(value)) return value.map(normalizeKubernetesSchema);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeKubernetesSchema(child)]),
  );
  if (
    normalized["x-kubernetes-int-or-string"] === true ||
    normalized.format === "int-or-string"
  ) {
    delete normalized.type;
    delete normalized.format;
    normalized.anyOf = [{ type: "integer" }, { type: "string" }];
  }
  return normalized;
}

async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listJsonFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat().filter((file) => file.endsWith(".json"));
}

const files = (await listJsonFiles(schemaRoot)).filter(
  (file) => path.basename(file) !== "index.json",
);

for (const file of files) {
  const schema = JSON.parse(await readFile(file, "utf8"));
  const validate = ajv.compile(normalizeKubernetesSchema(schema));
  const example = examples[schema["x-kubeconfig-schema"].kind];
  if (!example || !validate(example)) {
    throw new Error(
      `${path.relative(schemaRoot, file)} rejected its representative manifest: ${ajv.errorsText(validate.errors)}`,
    );
  }
}

console.log(`Validated ${files.length} self-contained API schemas`);
