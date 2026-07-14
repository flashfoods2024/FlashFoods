# Validation Checklist

## Pre-Commit Validation

Run these checks before committing any change:

### Syntax Check
```bash
node --check server.js
node --check routes/auth.js
# ... check all modified files
```

### Server Startup
```bash
npm start
# Verify: "Server running on http://localhost:3000" and "MongoDB connected"
```

### Smoke Tests
- [ ] Home page loads (GET /)
- [ ] Signup page loads (GET /signup)
- [ ] Login page loads (GET /login)
- [ ] Shops page loads (GET /shops)
- [ ] Cart page loads (GET /cart) — redirects to login if not authenticated
- [ ] All routes return 200 or expected redirect

### Regression Tests
- [ ] User can sign up and log in
- [ ] User can browse shops and menu items
- [ ] User can add items to cart
- [ ] User can complete checkout (mock payment)
- [ ] Vendor can view pending orders
- [ ] Vendor can accept/ready/cancel orders
- [ ] Admin can access dashboard
- [ ] Admin can manage shops, vendors, students
- [ ] Password reset flow works (token generation, email, reset)
- [ ] OTP verification works

### Dependency Validation
```bash
# Check for unused dependencies
node -e "const pkg = require('./package.json'); console.log(Object.keys(pkg.dependencies).join('\n'))"

# Verify all imports resolve
node --experimental-modules -e "
  import('./server.js').catch(e => console.error(e.message));
"
```

### Documentation Check
- [ ] `.ai/STATUS.md` updated if behavior changed
- [ ] `.ai/BUSINESS_RULES.md` updated if rules changed
- [ ] `.ai/DEPENDENCY_GRAPH.md` updated if imports changed
- [ ] Docs reflect current implementation

## Post-Deployment Validation

- [ ] Server starts in production mode
- [ ] MongoDB connection established
- [ ] Static assets served correctly
- [ ] Session management works
- [ ] Payment flow works (test mode)
- [ ] Webhook endpoints respond
- [ ] Socket.IO connections establish
