import {
  addError,
  validateDnsName,
  validateObjectMetadata,
  validatePort,
  validatePortName,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validateRoute(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors, { nameLabelOnly: true });
  addError(
    errors,
    "routeServiceName",
    validateDnsName(input.routeServiceName, "Service name", true),
  );
  if (input.routeHost.trim()) {
    addError(errors, "routeHost", validateDnsName(input.routeHost, "Hostname"));
  }
  if (input.routePath.trim() && !input.routePath.startsWith("/")) {
    errors.routePath = "Path must start with /.";
  } else if (/\s/.test(input.routePath)) {
    errors.routePath = "Path cannot contain spaces.";
  }
  if (input.routeTargetPort.trim()) {
    if (/^\d+$/.test(input.routeTargetPort)) {
      addError(errors, "routeTargetPort", validatePort(input.routeTargetPort, "Target port"));
    } else {
      addError(errors, "routeTargetPort", validatePortName(input.routeTargetPort));
    }
  }
  return errors;
}
