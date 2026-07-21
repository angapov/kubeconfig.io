import {
  addError,
  validateObjectMetadata,
  validatePort,
  validatePortName,
} from "./common";
import type { ValidationErrors, ValidationInput } from "./types";

export function validateService(input: ValidationInput) {
  const errors: ValidationErrors = {};
  validateObjectMetadata(input, errors, {
    labelsRequired: true,
    nameLabelOnly: true,
  });

  const portNames = new Set<string>();
  input.servicePorts.forEach((port) => {
    addError(errors, `service-port-name-${port.id}`, validatePortName(port.name));
    addError(errors, `service-port-${port.id}`, validatePort(port.port, "Service port"));
    addError(
      errors,
      `service-target-port-${port.id}`,
      validatePort(port.targetPort, "Target port", false),
    );
    if (input.servicePorts.length > 1 && !port.name) {
      errors[`service-port-name-${port.id}`] =
        "A unique name is required when a Service has multiple ports.";
    } else if (port.name && portNames.has(port.name)) {
      errors[`service-port-name-${port.id}`] = "Service port names must be unique.";
    }
    if (port.name) portNames.add(port.name);
  });
  return errors;
}
