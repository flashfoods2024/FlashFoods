# FlashFoods Autonomous Bug-Fix Protocol

Use this protocol whenever a test, verification pass, runtime check, or manual validation exposes a problem.

## Mandatory Loop

1. **Reproduce the failure.**
2. **Identify the root cause.**
3. **Do not patch symptoms blindly.**
4. **Inspect affected dependencies and shared logic.**
5. **Determine whether the issue is new or pre-existing.**
6. **Implement the smallest correct fix.**
7. **Run the failed test again.**
8. **Run relevant regression tests.**
9. **Verify the original requirement again.**
10. **Record the fix and continue.**

## Rules

- Do not lower the acceptance criteria to make a test pass.
- Do not delete a test merely because it fails.
- Do not mark a failure as acceptable without evidence and explicit scope.
- Do not introduce a large refactor to fix a small defect unless the existing architecture makes the small fix unsafe.
- When the bug is caused by shared logic, test every affected role/module.
- When the bug affects security, perform an abuse-case test after the fix.
- When the bug affects payments or money, verify calculation and persistence independently.
- When the bug affects time/date behaviour, test more than one timezone/environment where practical.

## Regression Rule

Every meaningful fix must trigger the smallest relevant regression set before the agent resumes feature work.

## Escalation Rule

If the original roadmap approach cannot satisfy a requirement:

- document why,
- design a safer alternative,
- implement it,
- test it,
- continue toward the same goal.

The inability to follow the preferred implementation strategy is not, by itself, a reason to stop.
