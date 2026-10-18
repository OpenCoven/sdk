---
"@opencoven/coven-client": minor
---

Add `CovenMissionsClient` for the Coven mission contract (OpenCoven/coven#1313):
`submit`, `get`, `cancel` and `watch` one owner-local familiar mission, over the
same Unix and Windows transports as `CovenAutomationsClient`. Submit and cancel
send one spec command envelope each, and only when the producer advertises the
`coven.automations.mission.*.v1` action. A submit whose answer is lost is resent
with the same adoption key up to three times within the deadline; if the outcome
is still unknown it throws `CovenMissionUncertain` with the key and the mission
id derived from it. Daemon refusals throw `CovenMissionError` with the typed
code. `watch` ends at the first terminal view and refuses views for another
principal or familiar with `CovenMissionContextMismatch`. The transports'
`sendCommand` and `readDefinitions` hooks now also accept mission requests.
