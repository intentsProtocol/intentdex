# 04 — API & WebSocket Specification

## 1. Fastify REST Endpoints

The relayer exposes standard REST endpoints for managing and inspecting TWAP orders.

---

### `POST /api/v1/twap/submit`
Submit a new TWAP parent order to the relayer scheduling queue.

**Request Body:**
```json
{
  "creatorPkh": "8a32b6e12f45...",
  "creatorCashAddr": "bchtest:qqmhr60gt2w2kz7aps6ds9rgv2e3f4ksdg3gye8det",
  "side": "BUY",
  "tokenCategory": "dfe50223c8d5cba8dcef8dff6d92b61deb88a8ba44947367f2b746487b56039b",
  "totalAmountIn": "50000",
  "minTotalAmountOut": "14500000",
  "numSlices": 10,
  "intervalSec": 60,
  "startTime": 1724680000,
  "maxPricePerUnit": "310"
}
```

**Response (`201 Created`):**
```json
{
  "status": "success",
  "orderId": "7b8f9e12-3456-4789-abcd-ef0123456789",
  "sliceAmountIn": "5000",
  "numSlices": 10,
  "estimatedEndTime": 1724680600,
  "status": "PENDING"
}
```

---

### `GET /api/v1/twap/:orderId`
Fetch the real-time execution status and slice fill records for a TWAP order.

**Response (`200 OK`):**
```json
{
  "orderId": "7b8f9e12-3456-4789-abcd-ef0123456789",
  "status": "RUNNING",
  "slicesCompleted": 4,
  "numSlices": 10,
  "progressPct": 40.0,
  "accumulatedAmountIn": "20000",
  "accumulatedAmountOut": "5980000",
  "averagePrice": 299.0,
  "sliceFills": [
    {
      "sliceIndex": 0,
      "executedAt": 1724680005,
      "txid": "64ed9f13091ef9f493e0cb7cb35a817d9a8604ef4e3a86de4b6d388fca732580",
      "covenantAddress": "bchtest:pvu7y54ak74g28l97c28g3yx7hxmcl0ka876vrusf38975y8vc69vqmphs2p4",
      "amountIn": "5000",
      "amountOut": "1495000",
      "makerFeeSats": "5000",
      "effectivePrice": 299.0
    }
  ]
}
```

---

### `POST /api/v1/twap/:orderId/cancel`
Cancel an active TWAP order. Remaining unexecuted slices will be stopped.

**Response (`200 OK`):**
```json
{
  "status": "cancelled",
  "orderId": "7b8f9e12-3456-4789-abcd-ef0123456789",
  "slicesCompleted": 4,
  "slicesCancelled": 6
}
```

---

## 2. Real-Time WebSocket Telemetry

Clients connect to `ws://localhost:3001/ws/v1/twap-stream` for live slice notifications.

### Event: `TWAP_SLICE_FILL`
Broadcast immediately after a slice transaction is accepted by the network.

```json
{
  "event": "TWAP_SLICE_FILL",
  "orderId": "7b8f9e12-3456-4789-abcd-ef0123456789",
  "sliceIndex": 4,
  "totalSlices": 10,
  "txid": "8d89e36c3773ba67a5d77fb9e4b76ac879e161122eb8d7bb77df0a3a1894ea8f",
  "amountIn": "5000",
  "amountOut": "1495000",
  "effectivePrice": 299.0,
  "makerPool": "bchtest:pvu7y54ak74g28l97c28g3yx7hxmcl0ka876vrusf38975y8vc69vqmphs2p4",
  "timestamp": 1724680245
}
```

### Event: `TWAP_COMPLETED`
Broadcast when the final slice executes.

```json
{
  "event": "TWAP_COMPLETED",
  "orderId": "7b8f9e12-3456-4789-abcd-ef0123456789",
  "totalFilled": "50000",
  "totalReceived": "14950000",
  "avgPrice": 299.0,
  "durationSec": 600,
  "timestamp": 1724680605
}
```
