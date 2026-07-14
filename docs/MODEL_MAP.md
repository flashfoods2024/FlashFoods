# Model Map

## Relationship Diagram

```mermaid
erDiagram
    User ||--o{ Shop : "owns (vendor)"
    User ||--o{ Order : "places (customer)"
    Shop ||--o{ MenuItem : "has"
    Shop ||--o{ Order : "receives"
    MenuItem ||--o{ OrderItem : "referenced in"
    
    User {
        ObjectId _id
        string name
        string email
        string passwordHash
        string role "student|vendor|admin"
        ObjectId shop "ref->Shop"
        boolean isActive
        Date disabledAt
        string resetPasswordToken
        Date resetPasswordExpires
        Date createdAt
        Date updatedAt
    }
    
    Shop {
        ObjectId _id
        string name
        string slug
        string description
        string image
        ObjectId vendor "ref->User"
        string paymentGateway "razorpay|easebuzz|phonepe|paytm|bharatpe"
        boolean paymentConfigured
        object paymentSettings
        boolean isOpen
        boolean isActive
        Date disabledAt
        Date createdAt
        Date updatedAt
    }
    
    MenuItem {
        ObjectId _id
        ObjectId shop "ref->Shop"
        string name
        string description
        number price
        string image
        boolean available
        string foodType "veg|non-veg|egg|unknown"
        array variants "[{label, price}]"
        Date createdAt
        Date updatedAt
    }
    
    Order {
        ObjectId _id
        ObjectId customer "ref->User"
        ObjectId shop "ref->Shop"
        array items "[OrderItem]"
        number total
        Date pickupTime
        Date collectedAt
        string status "pending_payment|paid|accepted|ready_for_pickup|completed|cancelled"
        string pickupOtp
        string paymentNote
        string transactionId
        string razorpayOrderId
        string razorpayPaymentId
        string webhookEventId
        string gatewayTxnId
        Date readyAt
        string refundStatus "none|pending|completed|failed"
        number originalTotal
        number updatedTotal
        number refundAmount
        Date adjustedAt
        ObjectId adjustedBy "ref->User"
        string adjustmentReason
        Date createdAt
        Date updatedAt
    }
    
    OrderItem {
        ObjectId menuItem "ref->MenuItem"
        string name
        number price
        number quantity
        string status "active|removed"
        number variantId
        string variantName
        number variantPrice
    }
```

## Model Details

### User
- **Collection:** users
- **Indexes:** email (unique)
- **Relationships:**
  - `shop` → Shop (optional, vendor only)
  - Referenced by Order.customer

### Shop
- **Collection:** shops
- **Indexes:** slug (unique)
- **Relationships:**
  - `vendor` → User (optional)
  - Referenced by MenuItem.shop, Order.shop

### MenuItem
- **Collection:** menuitems
- **Indexes:** { shop: 1, name: 1 }
- **Relationships:**
  - `shop` → Shop (required)
  - Referenced by Order.items[].menuItem

### Order
- **Collection:** orders
- **Indexes:**
  - { shop: 1, pickupOtp: 1 }
  - { shop: 1, status: 1 }
  - { customer: 1, createdAt: -1 }
  - { shop: 1, pickupTime: 1, createdAt: 1 }
  - { razorpayOrderId: 1 } (unique, sparse)
  - { gatewayTxnId: 1 } (unique, sparse)
- **Relationships:**
  - `customer` → User (required)
  - `shop` → Shop (required)
  - `adjustedBy` → User (optional)
  - `items[].menuItem` → MenuItem (optional reference)

## Embedded vs Referenced

| Document | Subdocs | References |
|----------|---------|------------|
| User | - | Shop (optional) |
| Shop | paymentSettings (embedded) | User (vendor) |
| MenuItem | variants (embedded array) | Shop |
| Order | items (embedded array) | User (customer), Shop, User (adjustedBy), MenuItem (items[].menuItem) |
