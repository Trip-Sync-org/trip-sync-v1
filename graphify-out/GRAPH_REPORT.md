# Graph Report - Trip-Sync  (2026-04-28)

## Corpus Check
- 109 files · ~3,592,566 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 444 nodes · 534 edges · 23 communities detected
- Extraction: 81% EXTRACTED · 19% INFERRED · 0% AMBIGUOUS · INFERRED: 104 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 26|Community 26]]

## God Nodes (most connected - your core abstractions)
1. `apiFetch()` - 17 edges
2. `catch()` - 17 edges
3. `VoiceManager` - 16 edges
4. `StubVoiceManager` - 15 edges
5. `WaitingRoomP2P` - 10 edges
6. `handler()` - 9 edges
7. `handler()` - 9 edges
8. `postVoice()` - 9 edges
9. `handler()` - 8 edges
10. `handler()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `handler()` --calls--> `blockMember()`  [INFERRED]
  backend\api\voice\kick.js → backend\lib\supabase.js
- `handler()` --calls--> `setTripVoiceMode()`  [INFERRED]
  backend\api\voice\mode.js → backend\lib\supabase.js
- `handler()` --calls--> `canAssignRole()`  [INFERRED]
  backend\api\voice\role.js → backend\lib\permissions.js
- `handler()` --calls--> `updateMemberRole()`  [INFERRED]
  backend\api\voice\role.js → backend\lib\supabase.js
- `broadcast()` --calls--> `tripChannel()`  [INFERRED]
  backend\lib\realtime.js → shared\voiceConstants.js

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (25): apiFetch(), apiUrl(), isAbortLikeError(), readApiErrorMessage(), formatShortDate(), formatTime12h(), setTimeOnDate(), attachCoupon() (+17 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (20): addPin(), applyCoupon(), asNum(), async(), closeAll(), confirmBooking(), endTrip(), handleLogin() (+12 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (19): allowSpeaker(), denySpeaker(), allowSpeakerAndUnmute(), appUserNumericId(), canonicalMemberIdStr(), dedupeMembersForMapPins(), denySpeakerOnly(), emitLastKnownPosition() (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (16): App(), handler(), post(), registerLiveTripMapRoutes(), registerPaymentRoutes(), getServerApp(), startLocalServer(), startServer() (+8 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (19): handler(), handler(), parseBody(), handler(), parseBody(), handler(), parseBody(), canAssignRole() (+11 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (12): handler(), handler(), send(), broadcastRaiseHand(), sortParticipants(), useParticipants(), useVoiceChannel(), normalizeRole() (+4 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (1): StubVoiceManager

### Community 7 - "Community 7"
Cohesion: 0.18
Nodes (4): cleanup(), close(), unwrapReactNativeWebrtc(), WaitingRoomP2P

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (1): VoiceManager

### Community 9 - "Community 9"
Cohesion: 0.26
Nodes (10): exportRevenuePdf(), buildPayoutHistoryHtml(), buildRevenueSummaryHtml(), esc(), money(), shareRevenuePdf(), formatRangeLabel(), getDateRangeForPreset() (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.44
Nodes (9): apiBase(), assignRole(), authHeaders(), fetchIceServers(), kickParticipant(), muteParticipant(), postVoice(), setVoiceAuthToken() (+1 more)

### Community 11 - "Community 11"
Cohesion: 0.25
Nodes (2): emitMapPinRequestedToStaff(), emitToPrivileged()

### Community 12 - "Community 12"
Cohesion: 0.28
Nodes (5): useAuthPalette(), AuthScreenShell(), getStyles(), ProfileLayout(), ResetEmailSentScreen()

### Community 13 - "Community 13"
Cohesion: 0.36
Nodes (5): asNum(), normalizeTripFromApi(), parseDateOnlyLocal(), startOfTodayLocal(), tripDateVsToday()

### Community 14 - "Community 14"
Cohesion: 0.29
Nodes (2): navigateToRootStack(), goStack()

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (1): MainActivity

### Community 16 - "Community 16"
Cohesion: 0.6
Nodes (4): aggregateRevenueFromRows(), computeOrganizerRevenue(), normalizeRevenueDateRange(), num()

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (2): haversineDistance(), haversineMeters()

### Community 18 - "Community 18"
Cohesion: 0.6
Nodes (3): assertMicEnvironment(), getMicStreamForVoice(), micErrorMessage()

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (1): MainApplication

### Community 20 - "Community 20"
Cohesion: 0.67
Nodes (2): joinTripRoom(), onConnect()

### Community 22 - "Community 22"
Cohesion: 1.0
Nodes (2): labelForRole(), ParticipantRow()

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (2): finishOnboarding(), onNext()

## Knowledge Gaps
- **Thin community `Community 6`** (16 nodes): `voiceManagerStub.ts`, `StubVoiceManager`, `.callRider()`, `.constructor()`, `.getConnectedRiders()`, `.getMuted()`, `.handleAnswer()`, `.handleIceCandidate()`, `.handleOffer()`, `.removeRider()`, `.setBlocked()`, `.setMuted()`, `.setRemoteMuted()`, `.setVoiceMode()`, `.start()`, `.stop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 8`** (16 nodes): `voiceManagerImpl.ts`, `VoiceManager`, `.callRider()`, `.constructor()`, `.createPeer()`, `.getConnectedRiders()`, `.getMuted()`, `.handleAnswer()`, `.handleIceCandidate()`, `.handleOffer()`, `.setBlocked()`, `.setMuted()`, `.setRemoteMuted()`, `.setVoiceMode()`, `.start()`, `.stop()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (9 nodes): `realtime.js`, `emitCheckpointsUpdated()`, `emitMapPinRequestedToStaff()`, `emitMapPinReviewedToUser()`, `emitToPrivileged()`, `getTripRiders()`, `haversineMeters()`, `removeRiderLocation()`, `upsertRiderLocation()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (7 nodes): `navigateRoot.ts`, `UserDashboardScreen.tsx`, `navigateToRootStack()`, `bookingsLoading()`, `goExploreTab()`, `goStack()`, `refresh()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 15`** (6 nodes): `MainActivity.kt`, `MainActivity`, `.createReactActivityDelegate()`, `.getMainComponentName()`, `.invokeDefaultOnBackPressed()`, `.onCreate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 17`** (6 nodes): `formatDistance()`, `getRouteSegmentMidpoints()`, `haversineDistance()`, `haversineMeters()`, `insertCheckpointByDistance()`, `checkpointUtils.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 19`** (4 nodes): `MainApplication.kt`, `MainApplication`, `.onConfigurationChanged()`, `.onCreate()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 20`** (4 nodes): `LiveTripMapNoProvider.tsx`, `joinTripRoom()`, `onConnect()`, `readLiveMapStoredTheme()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 22`** (3 nodes): `ParticipantRow.jsx`, `labelForRole()`, `ParticipantRow()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 26`** (3 nodes): `OnboardingScreen.tsx`, `finishOnboarding()`, `onNext()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cleanup()` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.163) - this node is a cross-community bridge._
- **Why does `catch()` connect `Community 1` to `Community 0`, `Community 10`?**
  _High betweenness centrality (0.141) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `apiFetch()` (e.g. with `geocodePlace()` and `useCurrentLocation()`) actually correct?**
  _`apiFetch()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 16 inferred relationships involving `catch()` (e.g. with `handleLogin()` and `handleSignup()`) actually correct?**
  _`catch()` has 16 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._