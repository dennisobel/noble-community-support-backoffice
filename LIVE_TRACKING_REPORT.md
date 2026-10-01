# Live Driver Tracking — End-to-End Implementation Report

> **Purpose:** This document captures the exact implementation of real-time driver location tracking across the Zigo platform so it can be replicated in other projects.
>
> All facts below are verified against source code as of May 2026.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Technical Methods](#3-technical-methods)
   - 3a. [Sockets (Socket.io)](#3a-sockets-socketio)
   - 3b. [REST API Polling](#3b-rest-api-polling)
   - 3c. [REST API — Location Write Endpoint](#3c-rest-api--location-write-endpoint)
4. [Data Transmission — Timing & Intervals](#4-data-transmission--timing--intervals)
5. [Data Payloads](#5-data-payloads)
6. [Backend Implementation](#6-backend-implementation)
7. [Driver App Implementation](#7-driver-app-implementation)
8. [Client App (Passenger) Implementation](#8-client-app-passenger-implementation)
9. [Corporate Web App Implementation](#9-corporate-web-app-implementation)
10. [Location Merging Strategy](#10-location-merging-strategy)
11. [Map Rendering](#11-map-rendering)
12. [Authentication & Security](#12-authentication--security)
13. [Complete Socket Event Reference](#13-complete-socket-event-reference)
14. [File Reference Index](#14-file-reference-index)
15. [Key Decisions & Trade-offs](#15-key-decisions--trade-offs)

---

## 1. System Overview

The Zigo live tracking system works similarly to Uber: once a driver accepts a job and begins navigating, their GPS coordinates are transmitted continuously to a central server and broadcast in real time to the relevant customer and/or corporate client.

Three applications are involved:

| App             | Stack               | Role                                                               |
| --------------- | ------------------- | ------------------------------------------------------------------ |
| **zigo-driver** | React Native / Expo | Collects and sends GPS coordinates                                 |
| **zigo**        | React Native / Expo | Passenger — receives and displays driver position                  |
| **zigo-corp**   | Next.js (web)       | Corporate client — receives and displays driver position           |
| **zigo-be**     | Node.js / Express   | Relay server — receives updates from driver, broadcasts to clients |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DRIVER (zigo-driver)                         │
│                                                                     │
│  Expo Location.watchPositionAsync()                                 │
│        │                                                            │
│        ▼ every 5s (active trip) / 30s (online, no trip)            │
│  ┌─────────────────────────┐   ┌───────────────────────────────┐   │
│  │  REST PUT /driver/status │   │  socket.emit('update-location')│  │
│  │  { location: {lat,lng} } │   │  { orderId, location:{lat,lng}}│  │
│  └────────────┬────────────┘   └───────────────┬───────────────┘   │
└───────────────┼────────────────────────────────┼───────────────────┘
                │ HTTP                            │ WebSocket
                ▼                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                     BACKEND (zigo-be)                            │
│                                                                  │
│  Express REST API          Socket.io Server                      │
│  Updates DB record         Validates orderId + location          │
│  (Driver.location)         Broadcasts to order room:             │
│                            socket.to(orderId).emit(              │
│                              'location-updated',                 │
│                              { orderId, location, timestamp }    │
│                            )                                     │
└────────────────────────────┬─────────────────────────────────────┘
                             │ WebSocket broadcast to order room
          ┌──────────────────┴──────────────────┐
          ▼                                      ▼
┌──────────────────────┐            ┌───────────────────────────┐
│   zigo (Passenger)   │            │  zigo-corp (Corporate)    │
│                      │            │                           │
│  Dual strategy:      │            │  Dual strategy:           │
│  1. Socket listener  │            │  1. Socket listener       │
│  2. REST polling     │            │  2. REST polling (10s)    │
│     (7.5s / 12.5s)   │            │     (fallback only)       │
│                      │            │                           │
│  Merge: use newest   │            │  Uses socket immediately; │
│  timestamp           │            │  REST only if no socket   │
│                      │            │  data yet                 │
│  React Native Map    │            │  Google Maps API          │
│  (react-native-maps  │            │  amber arrow marker       │
│   + Mapbox routes)   │            │  + Mapbox routes          │
└──────────────────────┘            └───────────────────────────┘
```

---

## 3. Technical Methods

### 3a. Sockets (Socket.io)

**Library:** `socket.io` (server), `socket.io-client` (clients)

Socket.io is the **primary, real-time channel** for location updates. It is used in every application.

#### Server initialisation (`zigo-be/src/socket.js`)

```js
import { Server } from "socket.io";

export const initSocket = server => {
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });
  // ... attach to Express HTTP server
};
```

#### Room model

Socket.io rooms are the key mechanism. Every order/trip has a **room named by its `orderId`**. All parties interested in a trip (driver, customer, corporate client, admin) join the same room and receive broadcasts.

```
Room: "<orderId>"
Members: driver + customer(s) + corporate client + admins
```

Additional rooms used for non-location events:

| Room                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `driver:<driverId>` | Push notifications to a specific driver                    |
| `user:<userId>`     | Push notifications to a specific customer                  |
| `admins`            | Broadcast to all admin sockets                             |
| `job:<jobId>`       | Real-time bid updates while customer is selecting a driver |

#### Core tracking flow

1. **Driver joins** the order room at journey start (auto, because the driver emits to the room).
2. **Customer / corp client** explicitly emits `join-order` when they open the tracking screen.
3. **Driver emits** `update-location` every 5 seconds.
4. **Server validates** the payload, then **broadcasts** `location-updated` to everyone else in the order room.
5. **Clients receive** `location-updated` and update the map marker.

```js
// Server — relay location update (socket.js lines 105-121)
socket.on("update-location", data => {
  const { orderId, location } = data || {};
  if (
    !orderId ||
    !location ||
    typeof location.lat !== "number" ||
    typeof location.lng !== "number"
  ) {
    console.warn("[socket] update-location rejected: invalid payload");
    return;
  }
  socket.to(String(orderId)).emit("location-updated", {
    orderId: String(orderId),
    location: { lat: location.lat, lng: location.lng },
    timestamp: new Date(),
  });
});
```

Note: `socket.to(room)` excludes the sender (the driver's own socket), so the driver does not receive its own location echo.

#### Client socket connection (`zigo/context/SocketContext.tsx`, `zigo-driver/context/SocketContext.tsx`)

All three frontend apps maintain a persistent Socket.io connection authenticated with a JWT:

```ts
// Pattern used in all three apps
import { io } from "socket.io-client";

const socket = io(BACKEND_URL, {
  transports: ["websocket"],
  auth: token ? { token } : undefined,
});
```

The driver app disconnects the socket when the app goes to the background (via `AppState` listener) and reconnects on foreground to conserve battery and connections.

#### Client — joining a room and listening for location

```ts
// Passenger app (zigo/app/orders/[id].tsx lines 481, 489-496)
socket.emit("join-order", orderId);

socket.on("location-updated", data => {
  if (data.orderId === orderId) {
    socketDriverRef.current = {
      latitude: data.location.lat,
      longitude: data.location.lng,
      at: Date.now(),
    };
    setDriverMergeEpoch(e => e + 1); // triggers re-render
  }
});
```

The client also re-joins the room on socket reconnect:

```ts
socket.on("connect", () => socket.emit("join-order", orderId));
```

---

### 3b. REST API Polling

Both client applications **supplement sockets with periodic REST polling** as a fallback. This guards against missed socket updates (e.g. brief disconnections).

#### Passenger app — TanStack Query refetch interval

```ts
// zigo/app/orders/[id].tsx lines 378-385
useQuery({
  queryKey: ["order", orderId],
  queryFn: () => api.orders.getOrder(orderId),
  refetchInterval: query => {
    const status = query.state.data?.order?.status;
    if (status === "in-transit" || status === "picked") return 7500; // 7.5 seconds
    if (status === "accepted" || status === "arrived") return 7500; // 7.5 seconds
    if (status === "confirmed") return 12500; // 12.5 seconds
    return false; // disabled for other statuses
  },
});
```

The order response includes `order.driver.location` with the driver's last-known coordinates from the database. These are compared with the most recent socket timestamp (see [Section 10](#10-location-merging-strategy)).

#### Corporate app — manual `setInterval`

```ts
// zigo-corp/components/TrackDeliveryModal.tsx lines 85-101
const poll = async () => {
  const res = await getMyTripJourney(trip.id);
  const loc = res?.journey?.driverLocation;
  if (loc?.lat != null && loc?.lng != null && !liveDriverLocation) {
    setLiveDriverLocation(loc); // only use REST if socket hasn't delivered yet
  }
  if (res?.journey?.status) setTripStatus(res.journey.status);
};
poll();
const id = setInterval(poll, 10_000); // 10 seconds
```

Key difference from the passenger app: the corporate app only uses the REST location if `liveDriverLocation` is still `null` (i.e. no socket data has arrived yet). Once the socket delivers the first update, the REST polling continues only for **trip status** updates.

---

### 3c. REST API — Location Write Endpoint

The driver also sends location via REST API on every update cycle (in addition to the socket). This persists the driver's coordinates to the database so REST polling from clients returns fresh data.

```
PUT /api/driver/status
Authorization: Bearer <JWT>

Body (location update):
{ "location": { "lat": -1.2921, "lng": 36.8219 } }

Body (status + location combined):
{ "status": "arrived", "lat": -1.2921, "lng": 36.8219 }
```

This endpoint updates the `Driver.location` field in MongoDB (stored as GeoJSON Point: `{ type: 'Point', coordinates: [lng, lat] }`) and the `Journey.driverLocation` field (`{ lat, lng }`).

---

## 4. Data Transmission — Timing & Intervals

This is the verified timing structure. The person who described "5-second or 10-second bursts" was correct for the active trip scenario:

| Context                                                                   | Interval                               | Channel                       | Source file                                               |
| ------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- | --------------------------------------------------------- |
| **Driver — active journey (navigating to pickup or dropoff)**             | **5 seconds**                          | Socket + REST                 | `zigo-driver/app/jobs/[id]/journey.tsx` line 63           |
| **Driver — online but no active trip (idle, browsing jobs)**              | **30 seconds**                         | Socket + REST                 | `zigo-driver/app/(tabs)/index.tsx` line 183               |
| **useLocationTracking hook default**                                      | **10 seconds**                         | (passed via `updateInterval`) | `zigo-driver/hooks/useLocationTracking.ts` line 23        |
| **Distance trigger (movement-based)**                                     | **50 metres**                          | Socket + REST                 | `useLocationTracking.ts` line 87 (`distanceInterval: 50`) |
| **Passenger app REST polling (in-transit / picked / accepted / arrived)** | **7.5 seconds**                        | REST                          | `zigo/app/orders/[id].tsx` line 381                       |
| **Passenger app REST polling (confirmed — trip not started)**             | **12.5 seconds**                       | REST                          | `zigo/app/orders/[id].tsx` line 383                       |
| **Corporate app REST polling**                                            | **10 seconds**                         | REST                          | `zigo-corp/components/TrackDeliveryModal.tsx` line 99     |
| **Route polyline refresh (driver screen)**                                | **30 seconds** or **~10 metres** moved | Mapbox API                    | `zigo-driver/app/jobs/[id]/journey.tsx` line 117          |
| **Auto-follow pan debounce (corp map)**                                   | **300 ms**                             | Google Maps pan               | `zigo-corp/components/TrackDeliveryModal.tsx` line 151    |

**Summary in plain language:**

- During an active delivery, the driver's phone emits its position every **5 seconds** (or when it moves 50 metres, whichever comes first).
- When the driver is online but not on a trip, updates drop to every **30 seconds** to save battery.
- Clients receive updates via the socket in near-real time (~5s lag end-to-end), and fall back to REST polling (7.5–12.5s on passenger, 10s on corporate) if the socket is interrupted.

---

## 5. Data Payloads

### Driver → Server (`update-location`)

```json
{
  "orderId": "664f3a1b2c9d4e0012abc123",
  "location": {
    "lat": -1.2921,
    "lng": 36.8219
  }
}
```

When the driver is **online but not on a trip** (home screen), `orderId` is omitted:

```json
{
  "location": {
    "lat": -1.2921,
    "lng": 36.8219
  }
}
```

Without an `orderId`, the server's validation check fails silently (the location is not broadcast to any order room), so only the REST API write persists it to the DB.

### Server → Clients (`location-updated`)

```json
{
  "orderId": "664f3a1b2c9d4e0012abc123",
  "location": {
    "lat": -1.2921,
    "lng": 36.8219
  },
  "timestamp": "2026-05-12T08:43:10.221Z"
}
```

### REST API response (order / journey)

The `Driver.location` field returned in GET order responses:

```json
{
  "driver": {
    "location": {
      "latitude": -1.2921,
      "longitude": 36.8219
    }
  }
}
```

The `Journey.driverLocation` field returned from `getMyTripJourney`:

```json
{
  "journey": {
    "driverLocation": { "lat": -1.2921, "lng": 36.8219 },
    "status": "in-transit"
  }
}
```

Note the field name difference: the socket and journey API use `lat`/`lng`, while the order's driver sub-document uses `latitude`/`longitude`.

---

## 6. Backend Implementation

**File:** `zigo-be/src/socket.js`

### Socket server lifecycle

```
initSocket(httpServer)
  └─ Creates Socket.io Server
  └─ Attaches optional JWT middleware
  └─ On connection:
       ├─ Auto-joins authenticated socket to its own room
       ├─ Registers event handlers (join-order, update-location, etc.)
       └─ On disconnect: logs, no cleanup needed (Socket.io handles rooms)
```

### JWT middleware

The middleware is **optional** — sockets without a token are accepted:

```js
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.userId = null;
    socket.userRole = null;
    return next(); // allow unauthenticated
  }
  // verify JWT, look up user/driver/admin
  // set socket.userId and socket.userRole
  next();
});
```

This means room membership is currently **trust-based** — any client that knows an `orderId` can join that room and receive location updates.

### Database models for location

**`Driver` model** — current position for geofence queries:

```js
location: {
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number] }, // [longitude, latitude]
}
// GeoJSON index: { location: '2dsphere' }
```

**`Journey` model** — live tracking state:

```js
driverLocation:  { lat: Number, lng: Number },
pickupLocation:  { lat: Number, lng: Number },
deliveryLocation:{ lat: Number, lng: Number },
```

---

## 7. Driver App Implementation

**Stack:** React Native + Expo (`zigo-driver`)

### Location hook (`hooks/useLocationTracking.ts`)

The hook wraps Expo's `Location.watchPositionAsync()`:

```ts
export function useLocationTracking(options = {}) {
  const { updateInterval = 10000, enabled = true, onLocationUpdate } = options;

  useEffect(() => {
    const startTracking = async () => {
      // 1. Request foreground permission (required)
      // 2. Request background permission on Android (optional, graceful fallback)
      // 3. Start watch subscription
      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: updateInterval, // time-based trigger
          distanceInterval: 50, // distance-based trigger (metres)
        },
        newLocation => {
          onLocationUpdate?.(newLocation.coords);
        }
      );
    };
    startTracking();
    return () => subscription?.remove();
  }, [enabled, updateInterval]);
}
```

Both `timeInterval` and `distanceInterval` are OR conditions — an update fires on **whichever happens first**.

### Journey screen — active trip tracking (`app/jobs/[id]/journey.tsx`)

```ts
// 5-second interval during active delivery
const { location } = useLocationTracking({
  enabled: true,
  updateInterval: 5000,
  onLocationUpdate: location => {
    // 1. Update local UI state immediately
    setJourneyState({ ...journeyState, driverLocation: { lat, lng } });

    // 2. REST API write (persists to DB)
    api.driver.updateLocation(location.latitude, location.longitude);

    // 3. Socket emit (real-time broadcast)
    if (socket?.connected && orderIdForRoom) {
      socket.emit("update-location", {
        orderId: orderIdForRoom,
        location: { lat: location.latitude, lng: location.longitude },
      });
    }
  },
});
```

The journey screen also joins the order room to receive chat messages and typing indicators from the customer.

### Home screen — idle online tracking (`app/(tabs)/index.tsx`)

```ts
// 30-second interval when driver is online but not on a trip
useLocationTracking({
  enabled: isOnline,
  updateInterval: 30000,
  onLocationUpdate: location => {
    api.driver.updateLocation(location.latitude, location.longitude); // REST
    if (socket?.connected) {
      socket.emit("update-location", {
        // Note: no orderId — this update is NOT broadcast to any order room
        location: { lat: location.latitude, lng: location.longitude },
      });
    }
  },
});
```

---

## 8. Client App (Passenger) Implementation

**Stack:** React Native + Expo (`zigo`)
**File:** `zigo/app/orders/[id].tsx`

### Dual-channel location reception

The passenger app uses both a socket listener and REST polling simultaneously. The result of each is stored in a ref with a timestamp:

```ts
/** Socket position + receipt time */
const socketDriverRef = useRef<{ latitude; longitude; at: number } | null>(
  null
);
/** REST position + receipt time (updated only when coords actually change) */
const restDriverRef = useRef<{ latitude; longitude; at: number } | null>(null);
const [driverMergeEpoch, setDriverMergeEpoch] = useState(0);
```

Socket updates:

```ts
socket.on("location-updated", data => {
  if (data.orderId === orderId) {
    socketDriverRef.current = {
      latitude: data.location.lat,
      longitude: data.location.lng,
      at: Date.now(),
    };
    setDriverMergeEpoch(e => e + 1);
  }
});
```

REST updates (triggered by TanStack Query refetch):

```ts
useEffect(() => {
  const loc = order?.driver?.location;
  if (loc?.latitude == null || loc?.longitude == null) return;
  const prev = restDriverRef.current;
  // Only update timestamp when coordinates actually change
  if (
    prev &&
    prev.latitude === loc.latitude &&
    prev.longitude === loc.longitude
  )
    return;
  restDriverRef.current = {
    latitude: loc.latitude,
    longitude: loc.longitude,
    at: Date.now(),
  };
  setDriverMergeEpoch(e => e + 1);
}, [order?.driver?.location?.latitude, order?.driver?.location?.longitude]);
```

### Status-based polling intervals

| Order status | REST poll interval |
| ------------ | ------------------ |
| `in-transit` | 7.5 seconds        |
| `picked`     | 7.5 seconds        |
| `accepted`   | 7.5 seconds        |
| `arrived`    | 7.5 seconds        |
| `confirmed`  | 12.5 seconds       |
| All others   | Disabled           |

### Socket reconnect — rejoin room

```ts
socket.on("connect", () => socket.emit("join-order", orderId));
```

This is critical: if the socket reconnects (e.g. after a network blip), the client automatically re-subscribes to the order room without user interaction.

---

## 9. Corporate Web App Implementation

**Stack:** Next.js (`zigo-corp`)
**File:** `zigo-corp/components/TrackDeliveryModal.tsx`

### Socket strategy

```ts
useEffect(() => {
  if (!isOpen || !socket || !trip.orderId || !isTrackable) return;
  const joinRoom = () => socket.emit("join-order", trip.orderId);
  joinRoom();
  socket.on("connect", joinRoom); // rejoin on reconnect

  socket.on("location-updated", data => {
    if (data.orderId === trip.orderId) {
      setLiveDriverLocation(data.location); // { lat, lng }
    }
  });
}, [isOpen, socket, trip.orderId, isTrackable]);
```

### REST polling strategy

```ts
useEffect(() => {
  if (!isOpen || !isTrackable) return;
  const poll = async () => {
    const res = await getMyTripJourney(trip.id);
    const loc = res?.journey?.driverLocation;
    // Only use REST location if socket hasn't delivered any data yet
    if (loc?.lat != null && loc?.lng != null && !liveDriverLocation) {
      setLiveDriverLocation(loc);
    }
    // Always update trip status from REST
    if (res?.journey?.status) setTripStatus(res.journey.status);
  };
  poll();
  const id = setInterval(poll, 10_000); // 10 seconds
  return () => clearInterval(id);
}, [isOpen, trip.id, isTrackable]);
```

The corporate app's merging strategy is simpler than the passenger app's: socket data always wins once received. REST location is only a cold-start fallback.

### Auto-follow with debounce

```ts
useEffect(() => {
  if (!mapRef.current || !followDriver || !liveDriverLocation) return;
  // Debounce 300ms to avoid excessive map pans on rapid updates
  panDebounceRef.current = setTimeout(() => {
    mapRef.current?.panTo(liveDriverLocation);
  }, 300);
}, [followDriver, liveDriverLocation?.lat, liveDriverLocation?.lng]);
```

---

## 10. Location Merging Strategy

The passenger app (`zigo`) implements the most sophisticated merging logic. Because socket and REST updates arrive asynchronously and may be out of order, the app picks whichever source has the **most recent timestamp**:

```ts
const mergedDriverLocation = useMemo(() => {
  const s = socketDriverRef.current;
  const r = restDriverRef.current;
  if (!s && !r) return null;
  if (!s) return { latitude: r.latitude, longitude: r.longitude };
  if (!r) return { latitude: s.latitude, longitude: s.longitude };
  // Use the more recent one
  return s.at >= r.at
    ? { latitude: s.latitude, longitude: s.longitude }
    : { latitude: r.latitude, longitude: r.longitude };
}, [driverMergeEpoch, orderId]);
```

This `mergedDriverLocation` is what is passed to the map component as the driver marker position.

**Why this matters:** If the socket delivers a position, then the REST poll returns an older position (e.g. from just before the driver moved), without timestamp comparison the marker would jump backwards. The merge ensures the marker always represents the newest known position.

---

## 11. Map Rendering

### Driver app (React Native — Mapbox)

- Library: custom `MapView` component wrapping `@rnmapbox/maps`
- Driver marker: type `'driver'` (custom icon)
- Pickup marker: type `'pickup'` (static)
- Delivery marker: type `'dropoff'` (static)
- Route polyline: fetched from Mapbox Directions API, refreshed every 30 seconds or when driver moves ~10m
- Follow mode: centres map on `[lng, lat]` of driver when enabled
- Fit bounds: calculates bounding box from driver + pickup + dropoff, adds 1.5× padding

```ts
// Region calculation (journey.tsx lines 240-262)
const allLats = [driverLat, pickupLat, dropoffLat];
const allLngs = [driverLng, pickupLng, dropoffLng];
const latDelta = (maxLat - minLat) * 1.5 || 0.01;
const lngDelta = (maxLng - minLng) * 1.5 || 0.01;
```

### Passenger app (React Native — Mapbox)

Same `MapView` component as the driver app but as a read-only view. The driver marker coordinate is updated from `mergedDriverLocation` on every `driverMergeEpoch` change.

### Corporate app (Google Maps API)

- Library: Google Maps JavaScript API (loaded dynamically)
- Driver marker: `google.maps.SymbolPath.FORWARD_CLOSED_ARROW`, scale 7, fill `#f59e0b` (amber), white stroke
- Pickup marker: green circle with label "A"
- Dropoff marker: red circle with label "B"
- Route polyline: Mapbox Directions API, purple (`#6B46C1`), drawn once on load
- Auto-follow: `map.panTo(liveDriverLocation)` debounced to 300ms
- Fit bounds: `map.fitBounds(bounds, {top:50, bottom:50, left:50, right:50})`
- Info windows: click driver marker → shows driver name + status

The corporate app uses Google Maps for rendering but **Mapbox for route calculation** (consistent with the mobile apps).

---

## 12. Authentication & Security

### Socket authentication

```
Driver/Client → Socket handshake with auth: { token: "<JWT>" }
Server middleware → jwt.verify(token, JWT_SECRET)
                 → resolves userId and role (user / driver / admin)
                 → allows connection regardless (no token = anonymous allowed)
```

Unauthenticated sockets can still join order rooms and receive `location-updated` events because room join (`join-order`) is not gated on authentication. This is noted in the socket.js comment as a backward-compatibility choice.

### REST API

All driver write endpoints are protected by a `protect` middleware that requires a valid JWT in the `Authorization: Bearer` header. Location updates via REST will be rejected without auth.

### Current limitations

- **Room access control:** Any client that knows an `orderId` can join the room and receive location updates. There is no server-side check that the joining client is actually a party to that order.
- **CORS:** Socket.io server accepts connections from any origin (`origin: '*'`). The code comment acknowledges this should be restricted in production.

---

## 13. Complete Socket Event Reference

| Event                  | Direction        | When emitted                        | Key payload fields                                     | Who receives it                                  |
| ---------------------- | ---------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `update-location`      | Driver → Server  | Every 5s (trip) or 30s (online)     | `orderId`, `location.lat`, `location.lng`              | Server only                                      |
| `location-updated`     | Server → Clients | When driver emits `update-location` | `orderId`, `location.lat`, `location.lng`, `timestamp` | All sockets in `orderId` room (excluding driver) |
| `join-order`           | Client → Server  | Page/screen load, and on reconnect  | `orderId`                                              | Server — adds socket to room                     |
| `join-job`             | Client → Server  | Bidding page load                   | `jobId`                                                | Server — adds socket to `job:<jobId>` room       |
| `register-driver`      | Driver → Server  | Login / app start                   | `driverId`                                             | Server — adds socket to `driver:<driverId>` room |
| `register-user`        | User → Server    | Login                               | `userId`                                               | Server — adds socket to `user:<userId>` room     |
| `order-message`        | Server → Clients | New chat message saved              | _(no payload)_                                         | All in order room                                |
| `chat-typing`          | Client → Server  | User starts typing in chat          | `orderId`, `senderType`                                | Relayed to all in order room                     |
| `chat-typing-stop`     | Client → Server  | User stops typing                   | `orderId`                                              | Relayed to all in order room                     |
| `order-status-updated` | Server → Clients | Order status changes                | `orderId`, `status`                                    | All in order room                                |
| `bids-updated`         | Server → Clients | New driver bid on a job             | `jobId`                                                | All in `job:<jobId>` room                        |

---

## 14. File Reference Index

### Backend (`zigo-be`)

| File                                  | Purpose                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `src/socket.js`                       | Socket.io server — all event handling, room management, location relay     |
| `src/models/journeyModel.js`          | Journey schema with `driverLocation`, `pickupLocation`, `deliveryLocation` |
| `src/models/orderModel.js`            | Order schema with pickup/dropoff lat/lng                                   |
| `src/models/driverModel.js`           | Driver schema with GeoJSON location point                                  |
| `src/controllers/driverController.js` | REST handler for `PUT /driver/status` (location write)                     |
| `src/routes/driverRoutes.js`          | Route definitions for driver endpoints                                     |

### Driver App (`zigo-driver`)

| File                           | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `hooks/useLocationTracking.ts` | Core GPS hook wrapping Expo `watchPositionAsync`                  |
| `app/jobs/[id]/journey.tsx`    | Journey screen — **5-second** location updates during active trip |
| `app/(tabs)/index.tsx`         | Home screen — **30-second** location updates while online         |
| `context/SocketContext.tsx`    | Socket.io connection management (JWT auth, AppState lifecycle)    |
| `services/api.ts`              | REST client — `updateLocation()`, `updateJourneyStatus()`         |

### Passenger App (`zigo`)

| File                           | Purpose                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `app/orders/[id].tsx`          | Order detail screen — socket listener + REST polling + location merge |
| `context/SocketContext.tsx`    | Socket.io connection management                                       |
| `services/api.ts`              | REST client — `getOrder()`, `getMessages()`, etc.                     |
| `components/MapView.tsx`       | Map component rendering driver + pickup + dropoff markers             |
| `services/mapboxDirections.ts` | Mapbox Directions API wrapper for route polylines                     |

### Corporate App (`zigo-corp`)

| File                                | Purpose                                                     |
| ----------------------------------- | ----------------------------------------------------------- |
| `app/trips/[id]/page.tsx`           | Trip detail page — socket listener for live updates         |
| `components/TrackDeliveryModal.tsx` | Full-screen tracking modal with Google Maps + REST fallback |
| `context/SocketContext.tsx`         | Socket.io connection management                             |
| `lib/api.ts`                        | REST client — `getMyTripJourney()`                          |
| `lib/mapboxDirections.ts`           | Mapbox Directions API wrapper                               |
| `lib/useGoogleMap.ts`               | Google Maps dynamic loader                                  |

---

## 15. Key Decisions & Trade-offs

### 1. Dual-channel (socket + REST) rather than socket-only

**Why:** Sockets can drop silently (network changes, app backgrounding). REST polling guarantees location freshness even in degraded conditions. The cost is extra HTTP traffic, which is acceptable at 7.5–10s intervals.

### 2. Timestamp-based merge (passenger app)

**Why:** Avoids the marker "jumping back" to an older REST position that arrives after a newer socket position. The implementation uses wall-clock `Date.now()` at the moment of receipt (not the server timestamp from the socket payload) to measure recency from the client's perspective.

### 3. Two different update rates (5s trip, 30s idle)

**Why:** During a trip, customers watch the map continuously — 5-second updates feel smooth. When the driver is idle, no customer is actively tracking them, so 30 seconds saves battery and server load.

### 4. 50-metre distance trigger in addition to time interval

**Why:** If the driver is stationary at a pickup, time-based updates would fire every 5 seconds sending identical coordinates. The distance trigger naturally suppresses redundant updates when there is no movement.

### 5. Socket.io rooms keyed by `orderId` (string)

**Why:** Simple, scalable fan-out. Adding admin monitoring requires only joining the same room — no server-side changes. The pattern is identical to Uber's documented approach.

### 6. REST polling only when status is active

**Why:** Avoids unnecessary API calls when a trip is completed, cancelled, or in a pre-assignment state where tracking is meaningless.

### 7. Corporate app uses Google Maps; mobile apps use Mapbox

**Why:** Google Maps JavaScript API is the most common web mapping solution. The mobile apps use Mapbox (`@rnmapbox/maps`) for richer React Native support. Both use the Mapbox Directions API for route calculation, ensuring consistent routing across platforms.

---

_Report generated from source code analysis — May 2026_
