--------------------------- MODULE GuardRuntime_INV7_Mutant ---------------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS 
    Principals,       \* Set of agent/user identities
    Tenants,          \* Set of tenant isolation domains
    HealthStates      \* {"Healthy", "Degraded"}

ActionIds == {"act_read", "act_write_high", "act_tainted"}

ActionRecord(id) ==
    IF id = "act_read" THEN [id |-> "act_read", isHighImpact |-> FALSE, requiresCap |-> FALSE, isTainted |-> FALSE]
    ELSE IF id = "act_write_high" THEN [id |-> "act_write_high", isHighImpact |-> TRUE, requiresCap |-> TRUE, isTainted |-> FALSE]
    ELSE IF id = "act_tainted" THEN [id |-> "act_tainted", isHighImpact |-> FALSE, requiresCap |-> TRUE, isTainted |-> TRUE]
    ELSE [id |-> "none", isHighImpact |-> FALSE, requiresCap |-> FALSE, isTainted |-> FALSE]

Actions == {ActionRecord(id) : id \in ActionIds}

VARIABLES 
    pipelineState,    \* Current pipeline execution stage
    currentAction,    \* Action currently undergoing evaluation
    capabilityStore,  \* Set of granted capabilities
    planCache,        \* Set of cached plan records [actionId, structuralHint, carriesAuthorizationVerdict, bypassesCapabilityCheck]
    runtimeHealth,    \* Current system health state
    confirmationPool, \* Set of tokens [id, actionId, valid, consumed]
    auditLog,         \* Sequence of audit records [index, actionId, verdict, validLink]
    lastVerdict       \* Last authoritative decision outcome: "NONE", "ALLOW", "BLOCK", "REQUIRE_CONFIRMATION"

vars == <<pipelineState, currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog, lastVerdict>>

NullAction == [id |-> "none", isHighImpact |-> FALSE, requiresCap |-> FALSE, isTainted |-> FALSE]

TypeInvariant ==
    /\ pipelineState \in {"IDLE", "SUBMITTED", "NORMALIZED", "CAP_CHECKED", "TAINT_CHECKED", 
                          "PLAN_LOOKUP", "RISK_CLASSIFIED", "HEALTH_CHECKED", "CONFIRMED", 
                          "EXECUTED", "AUDITED"}
    /\ lastVerdict \in {"NONE", "ALLOW", "BLOCK", "REQUIRE_CONFIRMATION"}
    /\ runtimeHealth \in HealthStates

(* -------------------------------------------------------------------------
   FORMAL INVARIANTS CHECKED BY TLC
   ------------------------------------------------------------------------- *)

(* INV-1: No Stale Execution *)
INV1_NoStaleExecution == 
    (pipelineState = "EXECUTED") => (lastVerdict = "ALLOW")

(* INV-2: Structural Invalidation on Change (Bounded action space) *)
INV2_StructuralInvalidationOnChange ==
    \A a1, a2 \in Actions:
        (a1.id # a2.id) => (a1 # a2)

(* INV-3: Cache is Non-Authorizing *)
INV3_CacheIsNonAuthorizing ==
    \A plan \in planCache:
        /\ plan.carriesAuthorizationVerdict = FALSE
        /\ plan.bypassesCapabilityCheck = FALSE

(* INV-4: High-Impact Actions Cannot Be Cache-Shortcut *)
INV4_HighImpactCannotBeCacheShortcut ==
    (pipelineState = "EXECUTED" /\ currentAction.isHighImpact) => 
        (\E tok \in confirmationPool: tok.actionId = currentAction.id /\ tok.consumed = TRUE)

(* INV-5: Fail Closed under Degraded Health *)
INV5_FailClosedUnderDegradation ==
    (runtimeHealth # "Healthy") => (lastVerdict \in {"BLOCK", "NONE"})

(* INV-6: No Approval Replay *)
INV6_NoApprovalReplay ==
    \A tok \in confirmationPool:
        (tok.consumed = TRUE => tok.valid = FALSE)

(* INV-7: Complete Auditability & Independent Verification *)
INV7_ExplainabilityAndAuditability ==
    (pipelineState = "AUDITED") => 
        (Len(auditLog) > 0 => auditLog[Len(auditLog)].validLink = TRUE)

(* Bounded State Space Constraint for TLC model checking *)
StateConstraint ==
    Len(auditLog) <= 1

(* -------------------------------------------------------------------------
   STATE TRANSITIONS
   ------------------------------------------------------------------------- *)

Init ==
    /\ pipelineState = "IDLE"
    /\ currentAction = NullAction
    /\ capabilityStore \in SUBSET Actions
    /\ planCache = {[actionId |-> a.id, structuralHint |-> "ast_path", carriesAuthorizationVerdict |-> FALSE, bypassesCapabilityCheck |-> FALSE] : a \in Actions}
    /\ runtimeHealth \in HealthStates
    /\ confirmationPool = {[id |-> a.id, actionId |-> a.id, valid |-> TRUE, consumed |-> FALSE] : a \in Actions}
    /\ auditLog = <<>>
    /\ lastVerdict = "NONE"

SubmitAction(a) ==
    /\ pipelineState = "IDLE"
    /\ currentAction' = a
    /\ pipelineState' = "SUBMITTED"
    /\ lastVerdict' = "NONE"
    /\ UNCHANGED <<capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog>>

Normalize ==
    /\ pipelineState = "SUBMITTED"
    /\ pipelineState' = "NORMALIZED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog, lastVerdict>>

CheckCapability ==
    /\ pipelineState = "NORMALIZED"
    /\ IF currentAction.requiresCap /\ ~(currentAction \in capabilityStore)
       THEN /\ lastVerdict' = "BLOCK"
            /\ pipelineState' = "AUDITED"
       ELSE /\ lastVerdict' = "NONE"
            /\ pipelineState' = "CAP_CHECKED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog>>

CheckTaint ==
    /\ pipelineState = "CAP_CHECKED"
    /\ IF currentAction.isTainted
       THEN /\ lastVerdict' = "BLOCK"
            /\ pipelineState' = "AUDITED"
       ELSE /\ lastVerdict' = "NONE"
            /\ pipelineState' = "TAINT_CHECKED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog>>

LookupPlanCache ==
    /\ pipelineState = "TAINT_CHECKED"
    /\ pipelineState' = "PLAN_LOOKUP"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog, lastVerdict>>

ClassifyRisk ==
    /\ pipelineState = "PLAN_LOOKUP"
    /\ pipelineState' = "RISK_CLASSIFIED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog, lastVerdict>>

CheckHealth ==
    /\ pipelineState = "RISK_CLASSIFIED"
    /\ IF runtimeHealth # "Healthy"
       THEN /\ lastVerdict' = "BLOCK"
            /\ pipelineState' = "AUDITED"
       ELSE /\ IF currentAction.isHighImpact
               THEN lastVerdict' = "REQUIRE_CONFIRMATION"
               ELSE lastVerdict' = "ALLOW"
            /\ pipelineState' = "HEALTH_CHECKED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog>>

ConfirmAction ==
    /\ pipelineState = "HEALTH_CHECKED"
    /\ IF lastVerdict = "REQUIRE_CONFIRMATION"
       THEN IF \E tok \in confirmationPool: tok.actionId = currentAction.id /\ tok.valid = TRUE /\ tok.consumed = FALSE
            THEN /\ lastVerdict' = "ALLOW"
                 /\ confirmationPool' = (confirmationPool \ {[id |-> currentAction.id, actionId |-> currentAction.id, valid |-> TRUE, consumed |-> FALSE]}) 
                                         \cup {[id |-> currentAction.id, actionId |-> currentAction.id, valid |-> FALSE, consumed |-> TRUE]}
                 /\ pipelineState' = "CONFIRMED"
            ELSE /\ lastVerdict' = "BLOCK"
                 /\ pipelineState' = "AUDITED"
                 /\ UNCHANGED confirmationPool
       ELSE /\ pipelineState' = "CONFIRMED"
            /\ UNCHANGED <<lastVerdict, confirmationPool>>
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, auditLog>>

Execute ==
    /\ pipelineState = "CONFIRMED"
    /\ IF lastVerdict = "ALLOW"
       THEN /\ pipelineState' = "EXECUTED"
       ELSE /\ pipelineState' = "AUDITED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog, lastVerdict>>

(* MUTATION (deliberate): validLink is hardcoded FALSE regardless of actual
   chain integrity. If INV7_ExplainabilityAndAuditability were a tautology
   (unfalsifiable, as the removed TypeScript simulation's INV-7 check was),
   TLC would report "No error has been found" here too. It must NOT: this
   mutant exists specifically to prove TLC catches a broken audit-link
   invariant, i.e. that INV-7 is a real, meaningful check. *)
Audit ==
    /\ pipelineState = "EXECUTED"
    /\ auditLog' = Append(auditLog, [index |-> Len(auditLog) + 1, actionId |-> currentAction.id, verdict |-> lastVerdict, validLink |-> FALSE])
    /\ pipelineState' = "AUDITED"
    /\ UNCHANGED <<currentAction, capabilityStore, planCache, runtimeHealth, confirmationPool, lastVerdict>>

Reset ==
    /\ pipelineState = "AUDITED"
    /\ pipelineState' = "IDLE"
    /\ currentAction' = NullAction
    /\ lastVerdict' = "NONE"
    /\ UNCHANGED <<capabilityStore, planCache, runtimeHealth, confirmationPool, auditLog>>

Next ==
    \/ (\E a \in Actions: SubmitAction(a))
    \/ Normalize
    \/ CheckCapability
    \/ CheckTaint
    \/ LookupPlanCache
    \/ ClassifyRisk
    \/ CheckHealth
    \/ ConfirmAction
    \/ Execute
    \/ Audit
    \/ Reset

Spec == Init /\ [][Next]_vars

=============================================================================
