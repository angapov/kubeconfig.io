import {
  validateJobSpec,
  validateObjectMetadata,
  validatePodTemplate,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validateJob(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors);
  validateJobSpec(input, errors);
  validatePodTemplate(input, errors);
  return errors;
}
