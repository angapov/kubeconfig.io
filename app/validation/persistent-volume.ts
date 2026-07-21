import {
  addError,
  validateDnsName,
  validateObjectMetadata,
  validateStorageQuantity,
  validateStorageSpec,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validatePersistentVolume(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors, { clusterScoped: true });
  validateStorageSpec(input, errors);
  addError(
    errors,
    "storageCapacity",
    validateStorageQuantity(input.storageCapacity, "Storage capacity"),
  );

  if (input.pvSourceType === "hostPath") {
    if (!input.pvHostPath.trim()) {
      errors.pvHostPath = "Host path is required.";
    } else if (!input.pvHostPath.startsWith("/")) {
      errors.pvHostPath = "Host path must be absolute and start with /.";
    }
  } else if (input.pvSourceType === "nfs") {
    if (!input.pvNfsServer.trim()) errors.pvNfsServer = "NFS server is required.";
    if (!input.pvNfsPath.trim()) {
      errors.pvNfsPath = "NFS export path is required.";
    } else if (!input.pvNfsPath.startsWith("/")) {
      errors.pvNfsPath = "NFS export path must start with /.";
    }
  } else if (input.pvSourceType === "csi") {
    addError(errors, "pvCsiDriver", validateDnsName(input.pvCsiDriver, "CSI driver"));
    if (!input.pvCsiVolumeHandle.trim()) {
      errors.pvCsiVolumeHandle = "Volume handle is required.";
    }
  }
  return errors;
}
