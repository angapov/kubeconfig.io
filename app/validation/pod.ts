import { validateObjectMetadata, validatePodTemplate } from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validatePod(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors, { labelsRequired: true });
  validatePodTemplate(input, errors);
  return errors;
}
