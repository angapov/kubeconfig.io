import {
  validateJobSpec,
  validateObjectMetadata,
  validatePodTemplate,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validateCronJob(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors);
  if (input.name.length > 52) {
    errors.name = "CronJob name must be 52 characters or fewer.";
  }
  if (!input.schedule.trim()) {
    errors.schedule = "Schedule is required.";
  }
  validateJobSpec(input, errors);
  validatePodTemplate(input, errors);
  return errors;
}
