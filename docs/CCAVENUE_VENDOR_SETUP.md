# CCAvenue Payment Integration - Vendor Setup Guide

## Quick Start for Vendors

### Prerequisites

- CCAvenue merchant account
- Shop already created in the system
- Admin access to payment settings

### Step 1: Get Your CCAvenue Credentials

1. Log in to your **CCAvenue Merchant Account**
2. Navigate to **Settings → Integration**
3. Copy and note down:
   - **Merchant ID** - Your unique merchant identifier
   - **Access Code** - Used to generate payment requests
   - **Working Key** - Used for AES-128-CBC encryption (keep secret!)

### Step 2: Configure Payment Settings in Your Canteen

1. Log in to your vendor account
2. Click **Payment Settings** from the menu
3. Select **CCAvenue** as the Payment Provider
4. Enter your credentials:
   - **Merchant ID**: [Your Merchant ID from step 1]
   - **API Key**: [Your Access Code from step 1]
   - **API Secret**: [Your Working Key from step 1] ⚠️ **KEEP THIS SECRET**
5. Click **Save payment settings**
6. You should see "Payments configured" message

### Step 3: Test Payment Flow

1. Go to your shop's menu and add items to cart
2. Proceed to checkout
3. Select a pickup time and click "Pay with CCAvenue"
4. You will be redirected to CCAvenue's secure payment page
5. Use test card details provided by CCAvenue for testing
6. After successful payment, you'll be redirected back and order will be created

### Step 4: Go Live

Once testing is complete:

1. Get production credentials from CCAvenue
2. Update your payment settings with production credentials
3. Merchant customers can now make real payments

## What Students Will See

When a student places an order through your canteen:

1. **Cart Page**: Shows "Pay with CCAvenue" button
2. **Payment Gateway**: Redirected to secure CCAvenue page
3. **Payment Entry**: Student enters payment details
4. **Confirmation**: Redirected back with order confirmation
5. **Order Status**: Can track order from their dashboard

## Security Best Practices

- ✅ Never share your Working Key with anyone
- ✅ Don't save credentials in notes or emails
- ✅ Use different credentials for test and production
- ✅ Verify orders from your CCAvenue dashboard
- ✅ Monitor transaction history regularly

## Troubleshooting

### "Payment settings not configured"

- Ensure all three fields are filled: Merchant ID, API Key, API Secret
- Click Save Payment Settings
- Verify "Payments configured" message appears

### "Payment gateway error"

- Check that credentials are correct (copy-paste carefully, no extra spaces)
- Verify your CCAvenue account is active
- Check with CCAvenue support if your account is in good standing

### "Order not created after payment"

- Payment may have been successful but confirmation not processed
- Check your CCAvenue dashboard for the transaction
- Contact support with transaction ID if needed

### Students redirected to cart after payment

- This might indicate a decryption error
- Verify Working Key matches exactly (case-sensitive)
- Check browser console for error messages
- Contact system administrator

## Credential Field Mapping

| Form Field  | CCAvenue Dashboard | Notes                         |
| ----------- | ------------------ | ----------------------------- |
| Merchant ID | Merchant ID        | Under Settings → Integration  |
| API Key     | Access Code        | For creating payment requests |
| API Secret  | Working Key        | For AES encryption/decryption |

## Support

### System Administrator

For issues with the canteen ordering system, contact your system admin

### CCAvenue Support

For payment gateway specific issues:

- Email: support@ccavenue.com
- Website: https://www.ccavenue.com
- Phone: Check your merchant account for support number

## Additional Resources

- [CCAvenue Integration Guide](https://www.ccavenue.com/integration/integration-guide)
- [CCAvenue Merchant Dashboard](https://merchant.ccavenue.com/)
- System Documentation: See `docs/CCAVENUE_SETUP.md` for technical details

## Refunds and Disputes

When refunding orders:

1. Go to **Orders** in your dashboard
2. Find the order to refund
3. Click **Refund** (if available)
4. System automatically processes refund through CCAvenue
5. Funds returned to student's original payment method

## Frequently Asked Questions

**Q: Can I switch payment providers?**
A: Yes, you can change the payment provider anytime in Payment Settings, but existing payments will still show the original provider.

**Q: Is my data secure?**
A: Payment credentials are encrypted during transmission. Never share credentials and always use HTTPS.

**Q: How long do transactions take to settle?**
A: CCAvenue typically settles transactions within 2-3 business days to your bank account.

**Q: Can I use multiple payment providers?**
A: Currently, each shop can only use one payment provider. Contact admin if you need multi-provider support.

**Q: What if payment fails?**
A: Student won't be charged and can retry. Try again with correct payment details.
