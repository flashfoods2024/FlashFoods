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

### F08 UI Standardization Checks
- [ ] Every in-scope screen verified at mobile 393×852 (matches `.ai/UI_STANDARD.md`)
- [ ] Every in-scope screen verified at desktop 1440×900 (unchanged from F08 baseline; Student Home exempt per F08-D3)
- [ ] No vendor or admin screen touched
- [ ] No business logic touched

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

---

## F09 Native-Feel Student Navigation (planned; not yet verified)

These checks apply only after the corresponding phase in `.ai/roadmap.md` is
implemented. This section defines the contract; it does not claim that any
F09 behavior currently passes.

### Environment and evidence

- [ ] Use an isolated/local server and database fixture. Never run the default
      Playwright global setup against a configured production database.
- [ ] Do not invoke live payment gateways, real push notifications, destructive
      seeds, or external production services.
- [ ] Record browser, viewport, route, cache state, request/response timings,
      console/page errors, and the exact commands actually run.
- [ ] Mark a check PASS only after it was executed and observed; mark blocked or
      unrun checks explicitly.

### Required navigation sequences

For each supported soft-navigation sequence, verify URL, document title, active
tab, `aria-current`, visible destination content, and no blank interval:

- [ ] Home → Browse (`/` → `/shops`)
- [ ] Browse → Home (`/shops` → `/`)
- [ ] Home → Orders (`/` → `/orders`)
- [ ] Orders → Cart (`/orders` → `/cart`)
- [ ] Cart → Orders (`/cart` → `/orders`)
- [ ] Browse → Orders (`/shops` → `/orders`)
- [ ] Browser Back and Forward through the same sequence

### Persistent-shell assertions

- [ ] The same `.portal-nav` DOM element remains mounted through every
      supported soft navigation.
- [ ] Exactly one navbar and one Liquid Glass renderer/canvas exist.
- [ ] The completed `liquidgl-pending` visibility fallback and zero-duration
      navbar transition behavior remain intact.
- [ ] Navbar geometry, bottom clearance, glass material, orange active pill,
      entrance animation, and card staggering remain correct.
- [ ] The document shell does not reload for an intercepted navigation, while
      direct URLs and fallback full-document navigations still work.

### Page behavior and cleanup

- [ ] Browse search and visual favourite controls initialize once after each
      supported content swap.
- [ ] Cart variants, quantities, order type, server-computed totals, and
      payment launch remain functional; mutations still use their existing
      server endpoints.
- [ ] Home notification interaction remains functional and does not duplicate
      listeners.
- [ ] Any included order polling stops before replacement and does not
      accumulate timers or requests.
- [ ] Repeated swaps do not duplicate listeners, observers, external SDK setup,
      or stale page state.

### Failure, redirect, and race cases

- [ ] Slow response keeps the existing shell/content usable and shows loading
      feedback without an artificial wait.
- [ ] Rapid repeated clicks abort or supersede stale work; an older response
      cannot overwrite a newer one.
- [ ] Failed request, 500 response, offline response, and cancelled request
      restore a usable prior state without a blank shell.
- [ ] Expired session/auth redirect goes to normal `/login` document navigation;
      the login document is never injected into student content.
- [ ] Unsupported route, modified click, new-tab click, download, payment
      redirect, and every state-changing form retain ordinary browser behavior.

### Responsive and motion checks

- [ ] Browser checks run at the mobile reference viewport 393×852 and at the
      supported 767/768 px boundary.
- [ ] Desktop rendering remains frozen at widths ≥768px, with the documented
      Student Home exception.
- [ ] Reduced-motion users receive an immediate, usable content swap without
      Liquid Glass animation or entrance/stagger motion.
- [ ] Content transition tuning is within the measured target range (starting
      around 160–220 ms) only after structural latency has been separated.
- [ ] No navbar opacity/position animation, blink, duplicate content, or
      arbitrary delay is introduced.

### What requires a browser

Browser/manual or isolated Playwright evidence is required for DOM identity,
Liquid Glass instance count, View Transition visuals, active-tab timing,
scroll/history behavior, reduced motion, rapid clicks, offline/slow responses,
and page-specific interaction after content replacement.

### What can be covered without a browser

Unit/integration tests may cover route authorization, response negotiation,
redirect/fallback decisions, lifecycle state helpers, request cancellation
logic, and server data equivalence. They do not replace the browser checks
above.
