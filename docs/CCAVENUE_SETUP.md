# CCAvenue Payment Gateway Integration

## Overview

This document explains how to set up and configure CCAvenue payment gateway for canteen payments.

## Environment Variables

Add these to your `.env` file for global CCAvenue configuration:

```env
# CCAvenue Global Credentials (fallback if shop-specific config not provided)
CCAVENUE_MERCHANT_ID=your_merchant_id
CCAVENUE_ACCESS_CODE=your_access_code
CCAVENUE_WORKING_KEY=your_working_key
CCAVENUE_REDIRECT_URL=https://yoursite.com/api/orders/ccavenue-callback
CCAVENUE_CANCEL_URL=https://yoursite.com/cart
SITE_URL=https://yoursite.com
```

## Shop Configuration

Each canteen (shop) can have its own CCAvenue credentials configured through the admin panel:

1. Go to **Admin Dashboard** → **Shops**
2. Click **Edit** on the canteen to configure
3. Set **Payment Provider** to "CCAvenue"
4. Enter CCAvenue credentials:
   - **Merchant ID** (from your CCAvenue merchant account)
   - **API Key** (Access Code from CCAvenue)
   - **API Secret** (Working Key from CCAvenue)
5. Check **Payment Configured** checkbox
6. Save

## How It Works

### Payment Flow

1. **Order Creation**
   - Student adds items to cart and clicks "Pay with CCAvenue"
   - Backend creates encrypted order data with amount, shop info, and redirect URL
   - Frontend receives encrypted payload

2. **Payment Gateway**
   - Frontend creates a hidden form with encrypted data
   - Form is auto-submitted to CCAvenue secure gateway
   - Student completes payment on CCAvenue website

3. **Payment Verification**
   - CCAvenue redirects back to `/api/orders/ccavenue-callback`
   - Backend decrypts the response using shop's Working Key
   - If payment successful, order is created and stored in database
   - Student is redirected to order confirmation page

4. **Order Management**
   - Vendor can see the paid order in their dashboard
   - Student receives pickup OTP after order is marked ready

## API Credentials

Get your CCAvenue credentials from:

1. Log in to CCAvenue Merchant Account
2. Go to **Settings** → **Integration**
3. Note down:
   - **Merchant ID**
   - **Access Code**
   - **Working Key** (keep this secret!)

## Security Considerations

- **Never expose the Working Key** in frontend code
- Working Key is only used on backend for encryption/decryption
- All communication between CCAvenue and your server uses encrypted data
- Each shop can have different credentials for better security isolation

## Testing

To test CCAvenue integration in sandbox/development:

1. Contact CCAvenue support for sandbox credentials
2. Update your environment with sandbox credentials
3. Test the complete payment flow
4. CCAvenue will provide test card details for testing

## Troubleshooting

### "CCAvenue credentials are not configured"

- Ensure the shop has payment credentials saved
- Check that "Payment Configured" is checked
- Verify credentials are correct in CCAvenue merchant account

### Payment verification fails

- Ensure the Working Key matches exactly (case-sensitive)
- Check that encryption/decryption is happening correctly
- Verify the encrypted response is not corrupted during transmission

### Student not redirected back

- Verify `CCAVENUE_REDIRECT_URL` is correct and accessible
- Check CCAvenue account settings for correct redirect URL
- Ensure callback route `/api/orders/ccavenue-callback` is accessible

## Implementation Details

### Encryption/Decryption

- Algorithm: AES-128-CBC
- Key: MD5 hash of Working Key
- IV: 16 zero bytes
- Encoding: Hex

### Verification

- Payment status must be "Success"
- Transaction ID is used to track payment
- All transaction details are stored in the database

## Support

For CCAvenue-specific issues, contact:

- CCAvenue Support: https://www.ccavenue.com/
- CCAvenue Documentation: https://www.ccavenue.com/integration/integration-guide
