# GuardRuntime Thesis: Deterministic Authorization-and-Execution Boundary for Autonomous Agents

## Abstract
Autonomous agents executing in high-stakes environments (e.g., enterprise infrastructure, finance, medical workflows) require deterministic security boundaries. Current Large Language Model (LLM) agents suffer from prompt injections, goal drift, and non-deterministic behavior. GuardRuntime introduces an authoritative 11-stage authorization-and-execution boundary governed by 7 mathematical invariants.

## The 7 Falsifiable Properties

### Property 1: No Stale Execution (`INV-1`)
An action cannot execute without current authorization freshly evaluated at decision time.
$$\forall a \in \text{Actions}: \text{Executed}(a) \implies (\text{Verdict}(a, \text{CurrentState}) = \text{ALLOW})$$

### Property 2: Invalidation on Meaningful Change (`INV-2`)
Changing a meaningful authorization input (principal, action parameters, tenant domain) invalidates previous action identity and approval fingerprint.
$$\forall a, a': a \neq a' \implies \text{Fingerprint}(a) \neq \text{Fingerprint}(a')$$

### Property 3: Cache is Non-Authorizing (`INV-3`)
A plan-cache hit cannot supply an authorization result or bypass current state checks. The cache provides execution preparation hints only.
$$\forall a, c \in \text{Cache}: \text{Consult}(c) \not\implies \text{DetermineVerdict}(a)$$

### Property 4: High-Impact Actions Cannot Be Cache-Shortcut (`INV-4`)
High-impact actions require deliberate policy handling and cannot bypass human confirmation or elevated privilege requirements through cache reuse.
$$\forall a: \text{HighImpact}(a) \land \text{CacheHit}(a) \implies \text{RequiresConfirmation}(a) \lor \text{HighPrivilegePolicy}(a)$$

### Property 5: Fail Closed under Degraded Health (`INV-5`)
Degraded health, unexpected evaluation exceptions, or missing policies strictly fail closed to `BLOCK`.
$$\text{Health}(\text{System}) \neq \text{HEALTHY} \implies \text{Verdict}(a) = \text{BLOCK}$$

### Property 6: No Approval Replay (`INV-6`)
Human approval cannot be replayed for a changed action, expired lease, or changed authorization state. Confirmation tokens are single-use and bound to the cryptographic fingerprint.
$$\forall \text{tok}: \text{Consumed}(\text{tok}) \implies \neg\text{Valid}(\text{tok})$$

### Property 7: Explainability & Independent Verification (`INV-7`)
Security-significant decisions are explainable from recorded state, and execution outcome is verified independently rather than trusting agent self-reports.
$$\forall d: \text{Explainable}(d) \land \text{TamperEvident}(d) \land \text{IndependentVerification}(d)$$
