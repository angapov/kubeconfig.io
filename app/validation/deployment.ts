import {
  validateObjectMetadata,
  validatePodTemplate,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validateDeployment(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors, { labelsRequired: true });
  const replicaCount = Number(input.replicas);
  if (!Number.isInteger(replicaCount) || replicaCount < 0) {
    errors.replicas = "Replicas must be a non-negative integer.";
  }
  validatePodTemplate(input, errors);
  return errors;
}
