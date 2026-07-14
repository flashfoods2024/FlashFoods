# Code Review Template

## Review Checklist

### Correctness
- [ ] Logic matches the requirements
- [ ] Edge cases handled (empty, null, invalid input)
- [ ] Error handling is appropriate
- [ ] Race conditions considered (async operations)
- [ ] Database queries are indexed (or explain why not)

### Security
- [ ] Input validation/sanitization
- [ ] Authorization checks (role-based access)
- [ ] No SQL/NoSQL injection vectors
- [ ] Sensitive data not exposed in logs or responses
- [ ] Payment data handled securely

### Architecture
- [ ] Follows existing patterns (see `.ai/COMMON_PATTERNS.md`)
- [ ] Business logic is not duplicated
- [ ] Separation of concerns maintained
- [ ] Dependencies are acyclic
- [ ] Changes preserve backward compatibility

### Maintainability
- [ ] Naming is clear and consistent
- [ ] Comments explain "why", not "what"
- [ ] Magic numbers replaced with named constants
- [ ] Functions are focused (single responsibility)
- [ ] No dead code added

### Testing
- [ ] Tests added/updated for the change
- [ ] Tests cover edge cases
- [ ] Tests are deterministic (no flakiness)
- [ ] Test coverage is meaningful (not just happy path)

### Performance
- [ ] No N+1 queries introduced
- [ ] Database queries use appropriate indexes
- [ ] Session/cache usage is appropriate
- [ ] No synchronous blocking operations

## Review Decision
- [ ] Approve
- [ ] Approve with comments
- [ ] Request changes (explain what and why)
