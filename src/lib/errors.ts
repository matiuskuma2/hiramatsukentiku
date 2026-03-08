// ==============================================
// API Error Code Policy (Step 2.5-D)
// ==============================================
// HTTP Status Code Mapping:
//   400 - Validation Error (invalid input, missing fields, type mismatch)
//   401 - Unauthenticated (no token, expired session, no email)
//   403 - Insufficient Permission (role not allowed)
//   404 - Not Found (resource does not exist)
//   409 - Conflict (optimistic lock, duplicate enqueue, state mismatch)
//   422 - Business Rule Violation (initial with existing snapshot, invalid state transition)
//   500 - Internal Server Error (unexpected)
// ==============================================

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INSUFFICIENT_PERMISSION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DUPLICATE_ENQUEUE'
  | 'OPTIMISTIC_LOCK_CONFLICT'
  | 'STATE_MISMATCH'
  | 'BUSINESS_RULE_VIOLATION'
  | 'INTERNAL_ERROR';

export interface ApiError {
  success: false;
  error: string;
  error_code: ErrorCode;
  data?: unknown;
}

// --- Factory functions ---

export function validationError(message: string, details?: unknown): { body: ApiError; status: 400 } {
  return {
    body: { success: false, error: message, error_code: 'VALIDATION_ERROR', data: details },
    status: 400,
  };
}

export function unauthenticatedError(message = 'Authentication required'): { body: ApiError; status: 401 } {
  return {
    body: { success: false, error: message, error_code: 'UNAUTHENTICATED' },
    status: 401,
  };
}

export function forbiddenError(message: string): { body: ApiError; status: 403 } {
  return {
    body: { success: false, error: message, error_code: 'INSUFFICIENT_PERMISSION' },
    status: 403,
  };
}

export function notFoundError(resource: string, id?: string | number): { body: ApiError; status: 404 } {
  const msg = id !== undefined ? `${resource} not found: ${id}` : `${resource} not found`;
  return {
    body: { success: false, error: msg, error_code: 'NOT_FOUND' },
    status: 404,
  };
}

export function conflictError(message: string, code: ErrorCode = 'CONFLICT', data?: unknown): { body: ApiError; status: 409 } {
  return {
    body: { success: false, error: message, error_code: code, data },
    status: 409,
  };
}

export function businessRuleError(message: string, data?: unknown): { body: ApiError; status: 422 } {
  return {
    body: { success: false, error: message, error_code: 'BUSINESS_RULE_VIOLATION', data },
    status: 422,
  };
}

export function internalError(message: string, data?: unknown): { body: ApiError; status: 500 } {
  return {
    body: { success: false, error: message, error_code: 'INTERNAL_ERROR', data },
    status: 500,
  };
}
