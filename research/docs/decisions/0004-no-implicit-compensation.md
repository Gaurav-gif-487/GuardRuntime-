# ADR 0004 — Recoverable requires an operational compensation handler

**Status:** accepted · **Applies to:** ARC / advanced reversibility

A tool declaration such as `compensatingAction: "reverse_refund"` is metadata, not proof that rollback exists. GuardRuntime therefore treats a recoverable action as recoverable only when the runtime receives a callable compensation handler for that tool. Without one, ARC downgrades the action to `destructive` and confirmation is mandatory.

This prevents a string in configuration from creating a false safety claim.
