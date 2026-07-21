import {
  addError,
  validateDnsName,
  validateObjectMetadata,
  validateStorageQuantity,
  validateStorageSpec,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validatePersistentVolumeClaim(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors);
  validateStorageSpec(input, errors);
  addError(
    errors,
    "storageRequest",
    validateStorageQuantity(input.storageRequest, "Storage request"),
  );
  if (input.pvcVolumeName.trim()) {
    addError(
      errors,
      "pvcVolumeName",
      validateDnsName(input.pvcVolumeName, "PersistentVolume name"),
    );
  }
  return errors;
}
