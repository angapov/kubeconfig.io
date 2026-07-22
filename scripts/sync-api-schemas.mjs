import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputRoot = path.join(process.cwd(), "public", "schemas");
const kubernetesVersions = ["1.36", "1.35", "1.34", "1.33", "1.32"];
const openShiftVersions = {
  "4.22": "1.35",
  "4.21": "1.34",
  "4.20": "1.33",
  "4.19": "1.32",
  "4.18": "1.31",
};

const kubernetesResources = [
  { kind: "Pod", apiVersion: "v1", group: "", version: "v1" },
  { kind: "Deployment", apiVersion: "apps/v1", group: "apps", version: "v1" },
  { kind: "Service", apiVersion: "v1", group: "", version: "v1" },
  { kind: "Job", apiVersion: "batch/v1", group: "batch", version: "v1" },
  { kind: "CronJob", apiVersion: "batch/v1", group: "batch", version: "v1" },
  { kind: "PersistentVolumeClaim", apiVersion: "v1", group: "", version: "v1" },
  { kind: "PersistentVolume", apiVersion: "v1", group: "", version: "v1" },
];

const routeResource = {
  kind: "Route",
  apiVersion: "route.openshift.io/v1",
  group: "route.openshift.io",
  version: "v1",
  definition: "com.github.openshift.api.route.v1.Route",
};

const documentCache = new Map();

async function downloadJson(url) {
  if (!documentCache.has(url)) {
    documentCache.set(
      url,
      fetch(url).then(async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to download ${url}: ${response.status} ${response.statusText}`);
        }
        return response.json();
      }),
    );
  }
  return documentCache.get(url);
}

function findDefinition(definitions, resource) {
  if (resource.definition && definitions[resource.definition]) return resource.definition;
  for (const [name, schema] of Object.entries(definitions)) {
    const gvks = schema["x-kubernetes-group-version-kind"];
    if (
      Array.isArray(gvks) &&
      gvks.some(
        (gvk) =>
          gvk.group === resource.group &&
          gvk.version === resource.version &&
          gvk.kind === resource.kind,
      )
    ) {
      return name;
    }
  }
  throw new Error(
    `Definition not found for ${resource.apiVersion} ${resource.kind}`,
  );
}

function collectDefinitionReferences(value, references) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDefinitionReferences(item, references));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && child.startsWith("#/definitions/")) {
      references.add(child.slice("#/definitions/".length).replaceAll("~1", "/").replaceAll("~0", "~"));
    } else {
      collectDefinitionReferences(child, references);
    }
  }
}

function bundleDefinition(definitions, rootName) {
  const requiredDefinitions = new Set([rootName]);
  const queue = [rootName];

  while (queue.length > 0) {
    const name = queue.shift();
    const definition = definitions[name];
    if (!definition) throw new Error(`Referenced definition ${name} was not found`);
    const references = new Set();
    collectDefinitionReferences(definition, references);
    for (const reference of references) {
      if (requiredDefinitions.has(reference)) continue;
      requiredDefinitions.add(reference);
      queue.push(reference);
    }
  }

  return Object.fromEntries(
    [...requiredDefinitions]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => [name, definitions[name]]),
  );
}

function pointerSegment(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

async function writeSchema({
  platform,
  platformVersion,
  kubernetesVersion,
  resource,
  document,
  source,
}) {
  const definitions = document.definitions;
  if (!definitions || typeof definitions !== "object") {
    throw new Error(`OpenAPI definitions are missing from ${source}`);
  }
  const rootName = findDefinition(definitions, resource);
  const relativeDirectory = path.join(platform.toLowerCase(), platformVersion);
  const relativePath = path.join(relativeDirectory, `${resource.kind}.json`);
  const bundle = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: `/schemas/${relativePath.split(path.sep).join("/")}`,
    title: `${resource.apiVersion} ${resource.kind}`,
    description: definitions[rootName].description,
    "x-kubeconfig-schema": {
      platform,
      platformVersion,
      kubernetesVersion,
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      source,
      sourceFormat: "OpenAPI 2.0",
    },
    $ref: `#/definitions/${pointerSegment(rootName)}`,
    definitions: bundleDefinition(definitions, rootName),
  };

  await mkdir(path.join(outputRoot, relativeDirectory), { recursive: true });
  await writeFile(path.join(outputRoot, relativePath), `${JSON.stringify(bundle)}\n`);
  return `/schemas/${relativePath.split(path.sep).join("/")}`;
}

async function main() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const index = {
    schemaVersion: 1,
    format: "Self-contained JSON Schema bundles extracted from version-pinned OpenAPI 2.0 documents",
    platforms: { Kubernetes: {}, OpenShift: {} },
  };

  const kubernetesDocuments = new Map();
  async function getKubernetesDocument(version) {
    if (!kubernetesDocuments.has(version)) {
      const source = `https://raw.githubusercontent.com/kubernetes/kubernetes/v${version}.0/api/openapi-spec/swagger.json`;
      kubernetesDocuments.set(version, { source, document: downloadJson(source) });
    }
    const entry = kubernetesDocuments.get(version);
    return { source: entry.source, document: await entry.document };
  }

  for (const version of kubernetesVersions) {
    const { source, document } = await getKubernetesDocument(version);
    const resources = {};
    for (const resource of kubernetesResources) {
      resources[resource.kind] = await writeSchema({
        platform: "Kubernetes",
        platformVersion: version,
        kubernetesVersion: version,
        resource,
        document,
        source,
      });
    }
    index.platforms.Kubernetes[version] = { resources, source };
  }

  for (const [version, kubernetesVersion] of Object.entries(openShiftVersions)) {
    const { source: kubernetesSource, document: kubernetesDocument } =
      await getKubernetesDocument(kubernetesVersion);
    const openShiftSource =
      `https://raw.githubusercontent.com/openshift/api/release-${version}/openapi/openapi.json`;
    const openShiftDocument = await downloadJson(openShiftSource);
    const resources = {};

    for (const resource of kubernetesResources) {
      resources[resource.kind] = await writeSchema({
        platform: "OpenShift",
        platformVersion: version,
        kubernetesVersion,
        resource,
        document: kubernetesDocument,
        source: kubernetesSource,
      });
    }
    resources.Route = await writeSchema({
      platform: "OpenShift",
      platformVersion: version,
      kubernetesVersion,
      resource: routeResource,
      document: openShiftDocument,
      source: openShiftSource,
    });
    index.platforms.OpenShift[version] = {
      kubernetesVersion,
      resources,
      sources: { kubernetes: kubernetesSource, openShift: openShiftSource },
    };
  }

  await writeFile(path.join(outputRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  const schemaCount = Object.values(index.platforms).reduce(
    (total, versions) =>
      total +
      Object.values(versions).reduce(
        (versionTotal, entry) => versionTotal + Object.keys(entry.resources).length,
        0,
      ),
    0,
  );
  console.log(`Generated ${schemaCount} schemas in ${outputRoot}`);
}

await main();
