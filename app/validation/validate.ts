import { validateCronJob } from "./cron-job";
import { validateDeployment } from "./deployment";
import { validateJob } from "./job";
import { validatePersistentVolume } from "./persistent-volume";
import { validatePersistentVolumeClaim } from "./persistent-volume-claim";
import { validatePod } from "./pod";
import { validateRoute } from "./route";
import { validateService } from "./service";
import type { ObjectValidator, ResourceKind, ValidationInput } from "./types";

const validators: Record<ResourceKind, ObjectValidator> = {
  CronJob: validateCronJob,
  Deployment: validateDeployment,
  Job: validateJob,
  PersistentVolume: validatePersistentVolume,
  PersistentVolumeClaim: validatePersistentVolumeClaim,
  Pod: validatePod,
  Route: validateRoute,
  Service: validateService,
};

export function validateManifestFields(input: ValidationInput) {
  return validators[input.kind](input);
}
