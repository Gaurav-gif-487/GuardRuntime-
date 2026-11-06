---------------------------- MODULE GuardRuntime_StaleApproval_Mutant ----------------------------
(*
  STATUS: MODEL-READY; requires a real TLC run before any property is called
  formally verified.

  This finite-state model mirrors the GuardRuntime authorization boundary:
    current authorization state -> optional non-authorizing plan cache ->
    current risk -> confirmation/final re-check -> execution -> explanation.

  The model intentionally abstracts implementation details, but keeps the
  security-relevant identity needed by the seven thesis properties:
    - per-tenant authorization and policy epochs;
    - exact confirmation fingerprints;
    - exact confirmation record attached to an execution;
    - high-impact action classification;
    - recorded rationale for every execution.

  A successful TLC run proves these properties only for this finite model and
  its configured state bound. It is not a proof of the TypeScript
  implementation as a whole.
*)

EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS
  Tenants,
  Principals,
  Actions,
  AuthStates,
  PolicyVersions,
  HighImpactActions

ASSUME HighImpactActions \subseteq Actions

VARIABLES
  authState,
  policyVersion,
  authEpoch,
  policyEpoch,
  healthy,
  cache,
  confirmations,
  executed,
  now

vars == << authState, policyVersion, authEpoch, policyEpoch, healthy, cache, confirmations, executed, now >>

PrepMeta == [steps: Nat, scopeHint: {"scope"}]

(* NOTE:
   these were previously "NoPlan == [kind: \"no-plan\"]" and
   "NoConfirmation == [kind: \"no-confirmation\"]", using TLA+'s
   record-TYPE/set constructor ([field: SetOfValues]) where a concrete
   record VALUE was intended. "no-plan"/"no-confirmation" are strings,
   not sets, so TLC cannot enumerate them there -- this is a plain
   syntax bug (":" vs "|->"), not a discriminated-union limitation
   requiring the community Variant module. Both are used as concrete
   values elsewhere (cache's Init/WriteCache; ExecuteWithoutConfirmation's
   confirmation field), so both were live crashes, not dead code.
   Heterogeneous field shapes across cache/confirmation variants do not
   themselves need unifying: TLC allows non-uniform record shapes inside
   a function's range or a set; only the "[h1:e1,...]" type-constructor
   form requires uniform shape, and nothing here depends on that form
   at runtime. *)
NoPlan == [kind |-> "no-plan"]
NoConfirmation == [kind |-> "no-confirmation"]

(* Current risk is deliberately independent of cache contents. *)
ClassifyRisk(act, st) == (act \in HighImpactActions) /\ st \in AuthStates

ConfirmationRecord == [
  kind: "confirmation",
  tenant: Tenants,
  principal: Principals,
  action: Actions,
  policyVersionAtGrant: PolicyVersions,
  authStateAtGrant: AuthStates,
  authEpochAtGrant: Nat,
  policyEpochAtGrant: Nat,
  grantedAt: Nat
]

ExecutionRecord == [
  tenant: Tenants,
  principal: Principals,
  action: Actions,
  at: Nat,
  usedConfirmation: BOOLEAN,
  confirmation: ConfirmationRecord \cup {NoConfirmation},
  policyVersionAtUse: PolicyVersions,
  authStateAtUse: AuthStates,
  authEpochAtUse: Nat,
  policyEpochAtUse: Nat,
  healthyAtUse: BOOLEAN,
  cacheWasHit: BOOLEAN,
  authorizationSource: STRING,
  rationale: STRING
]

Init ==
  /\ authState = [t \in Tenants |-> CHOOSE s \in AuthStates : TRUE]
  /\ policyVersion = [t \in Tenants |-> CHOOSE p \in PolicyVersions : TRUE]
  /\ authEpoch = [t \in Tenants |-> 0]
  /\ policyEpoch = [t \in Tenants |-> 0]
  /\ healthy = TRUE
  /\ cache = [t \in Tenants |-> [a \in Actions |-> NoPlan]]
  /\ confirmations = {}
  /\ executed = {}
  /\ now = 0

ChangeAuthState(t) ==
  /\ t \in Tenants
  /\ \E s \in AuthStates :
       /\ s # authState[t]
       /\ authState' = [authState EXCEPT ![t] = s]
  /\ authEpoch' = [authEpoch EXCEPT ![t] = @ + 1]
  /\ UNCHANGED << policyVersion, policyEpoch, healthy, cache, confirmations, executed >>
  /\ now' = now + 1

ChangePolicyVersion(t) ==
  /\ t \in Tenants
  /\ \E p \in PolicyVersions :
       /\ p # policyVersion[t]
       /\ policyVersion' = [policyVersion EXCEPT ![t] = p]
  /\ policyEpoch' = [policyEpoch EXCEPT ![t] = @ + 1]
  /\ UNCHANGED << authState, authEpoch, healthy, cache, confirmations, executed >>
  /\ now' = now + 1

ToggleHealth ==
  /\ healthy' = ~healthy
  /\ UNCHANGED << authState, policyVersion, authEpoch, policyEpoch, cache, confirmations, executed >>
  /\ now' = now + 1

WriteCache(t, a) ==
  /\ t \in Tenants /\ a \in Actions
  /\ cache' = [cache EXCEPT ![t][a] = [steps |-> 1, scopeHint |-> "scope"]]
  /\ UNCHANGED << authState, policyVersion, authEpoch, policyEpoch, healthy, confirmations, executed >>
  /\ now' = now + 1

GrantConfirmation(t, p, a) ==
  /\ t \in Tenants /\ p \in Principals /\ a \in Actions
  /\ LET rec == [
       kind |-> "confirmation",
       tenant |-> t,
       principal |-> p,
       action |-> a,
       policyVersionAtGrant |-> policyVersion[t],
       authStateAtGrant |-> authState[t],
       authEpochAtGrant |-> authEpoch[t],
       policyEpochAtGrant |-> policyEpoch[t],
       grantedAt |-> now
     ]
     IN confirmations' = confirmations \cup {rec}
  /\ UNCHANGED << authState, policyVersion, authEpoch, policyEpoch, healthy, cache, executed >>
  /\ now' = now + 1

ConfirmationIsCurrent(rec) ==
  /\ rec.policyVersionAtGrant = policyVersion[rec.tenant]
  /\ rec.authStateAtGrant = authState[rec.tenant]
  /\ rec.policyEpochAtGrant = policyEpoch[rec.tenant]
  /\ rec.authEpochAtGrant = authEpoch[rec.tenant]

ExecuteWithConfirmation(t, p, a, cacheHit) ==
  /\ cacheHit \in BOOLEAN
  /\ t \in Tenants /\ p \in Principals /\ a \in Actions
  /\ healthy = TRUE
  /\ \E rec \in confirmations :
       /\ rec.tenant = t
       /\ rec.principal = p
       /\ rec.action = a
       /\ executed' = executed \cup {[
            tenant |-> t,
            principal |-> p,
            action |-> a,
            at |-> now,
            usedConfirmation |-> TRUE,
            confirmation |-> rec,
            policyVersionAtUse |-> policyVersion[t],
            authStateAtUse |-> authState[t],
            authEpochAtUse |-> authEpoch[t],
            policyEpochAtUse |-> policyEpoch[t],
            healthyAtUse |-> healthy,
            cacheWasHit |-> cacheHit,
            authorizationSource |-> "current-state",
            rationale |-> "current confirmation and authorization state accepted"
          ]}
  /\ UNCHANGED << authState, policyVersion, authEpoch, policyEpoch, healthy, cache, confirmations >>
  /\ now' = now + 1

ExecuteWithoutConfirmation(t, p, a, cacheHit) ==
  /\ cacheHit \in BOOLEAN
  /\ t \in Tenants /\ p \in Principals /\ a \in Actions
  /\ healthy = TRUE
  /\ a \notin HighImpactActions
  /\ ~ClassifyRisk(a, authState[t])
  /\ executed' = executed \cup {[
       tenant |-> t,
       principal |-> p,
       action |-> a,
       at |-> now,
       usedConfirmation |-> FALSE,
       confirmation |-> NoConfirmation,
       policyVersionAtUse |-> policyVersion[t],
       authStateAtUse |-> authState[t],
       authEpochAtUse |-> authEpoch[t],
       policyEpochAtUse |-> policyEpoch[t],
       healthyAtUse |-> healthy,
       cacheWasHit |-> cacheHit,
       authorizationSource |-> "current-state",
       rationale |-> "low-impact action allowed under current authorization state"
     ]}
  /\ UNCHANGED << authState, policyVersion, authEpoch, policyEpoch, healthy, cache, confirmations >>
  /\ now' = now + 1

Next ==
  \/ \E t \in Tenants : ChangeAuthState(t)
  \/ \E t \in Tenants : ChangePolicyVersion(t)
  \/ ToggleHealth
  \/ \E t \in Tenants, a \in Actions : WriteCache(t, a)
  \/ \E t \in Tenants, p \in Principals, a \in Actions : GrantConfirmation(t, p, a)
  \/ \E t \in Tenants, p \in Principals, a \in Actions, cacheHit \in BOOLEAN : ExecuteWithConfirmation(t, p, a, cacheHit)
  \/ \E t \in Tenants, p \in Principals, a \in Actions, cacheHit \in BOOLEAN : ExecuteWithoutConfirmation(t, p, a, cacheHit)

Spec == Init /\ [][Next]_vars

(* State constraint bounding the model's clock so TLC's search terminates.
   TLC's CONSTRAINT config directive requires a defined operator, not a
   raw inline expression -- this was previously "CONSTRAINT now <= 8" in
   the .cfg file directly, which TLC rejects at load time. *)
StateConstraint == now <= 8

(* Property 3: a plan-cache hit is never itself an authorization source. *)
CacheHitNeverGrantsAuthorization ==
  \A er \in executed :
    er.cacheWasHit => er.authorizationSource = "current-state"

(* Property 2 + Property 6: meaningful authorization changes invalidate the
   exact confirmation record. Epochs prevent a change that later returns to
   the same opaque value from being mistaken for no change. *)
MeaningfulChangeInvalidatesApproval ==
  \A er \in executed :
    er.usedConfirmation =>
      /\ er.confirmation.policyVersionAtGrant = er.policyVersionAtUse
      /\ er.confirmation.authStateAtGrant = er.authStateAtUse
      /\ er.confirmation.policyEpochAtGrant = er.policyEpochAtUse
      /\ er.confirmation.authEpochAtGrant = er.authEpochAtUse

StaleApprovalCannotReplay == MeaningfulChangeInvalidatesApproval

(* Property 1: the execution record contains the authorization snapshot used
   at the side-effect boundary. *)
CurrentAuthorizationAtExecution ==
  \A er \in executed :
    /\ er.authEpochAtUse >= 0
    /\ er.policyEpochAtUse >= 0
    /\ er.authStateAtUse \in AuthStates
    /\ er.policyVersionAtUse \in PolicyVersions
    /\ IF er.usedConfirmation
          THEN /\ er.confirmation.authStateAtGrant = er.authStateAtUse
               /\ er.confirmation.policyVersionAtGrant = er.policyVersionAtUse
          ELSE ~ClassifyRisk(er.action, er.authStateAtUse)

(* Property 4: high-impact actions cannot be executed without confirmation,
   including when a plan-cache hit exists. *)
HighImpactActionsRequireConfirmation ==
  \A er \in executed :
    er.action \in HighImpactActions => er.usedConfirmation

(* Property 5: an execution without confirmation can only occur while the
   runtime was healthy at the execution boundary. *)
NoExecutionWhenUnhealthyWithoutConfirmation ==
  \A er \in executed :
    er.usedConfirmation = FALSE => er.healthyAtUse = TRUE

(* Property 7: every security-significant execution has a non-empty rationale
   and a recorded authorization source/state. *)
SecuritySignificantDecisionsExplainable ==
  \A er \in executed :
    /\ Len(er.rationale) > 0
    /\ Len(er.authorizationSource) > 0
    /\ er.policyVersionAtUse \in PolicyVersions
    /\ er.authStateAtUse \in AuthStates

=============================================================================
