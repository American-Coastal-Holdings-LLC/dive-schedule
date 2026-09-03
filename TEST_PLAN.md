# Dive Schedule Pricing & Pay Visibility Fix - Test Plan

## Overview
This fix ensures that all divers can see job pricing and their pay information without page refreshes.

## Changes Made

### 1. Permission Update (`api/scripts/devtoken.mjs`)
- **Change**: Added `P.JOBS_VIEW_PRICING` to diver (riley) role permissions
- **Line 57**: `permissions: [P.JOBS_VIEW_ASSIGNED, P.JOBS_COMPLETE, P.JOBS_VIEW_PRICING, P.PAY_VIEW_OWN, P.INVENTORY_VIEW]`

### 2. Auto-Refresh Infrastructure (Already in Place)
- **JobsTab.tsx**: Uses `useResource` hook which refetches on window focus
- **PayTab.tsx**: Uses `useResource` hook which refetches on window focus  
- **JobDetailModal.tsx**: Calls `onClose()` which triggers parent reload after mutations

## Test Cases

### Test 1: Diver Can See Pricing in Jobs Tab
**Objective**: Verify that divers can view job prices when viewing the jobs board

**Steps**:
1. Start dev server: `npm run dev`
2. Generate diver token: `node api/scripts/devtoken.mjs riley`
3. Log in as Riley Chen (diver)
4. Navigate to Jobs tab
5. View an unfinished job card

**Expected Result**:
- Job card displays price chip (e.g., "$220.00")
- Price appears next to the footage/owner information

**Pass/Fail**: ___

---

### Test 2: Diver Can See Pricing in Job Detail
**Objective**: Verify that divers can see full pricing when opening job details

**Steps**:
1. Logged in as Riley Chen
2. Click on a job card to open JobDetailModal
3. Scroll to "Price" section

**Expected Result**:
- "Price" row displays with the job's price value
- Price is clearly visible (not stripped or hidden)

**Pass/Fail**: ___

---

### Test 3: Diver Can See Weekly Pay Breakdown
**Objective**: Verify divers can view their own weekly pay with earnings details

**Steps**:
1. Logged in as Riley Chen
2. Navigate to Pay tab
3. View current week's summary and daily breakdown

**Expected Result**:
- Week total displays (e.g., "Earned so far this week: $440.00")
- Daily breakdown shows each job with earnings
- Navigation between weeks works (previous/next buttons)
- "Next week" button disabled (cannot view future weeks)

**Pass/Fail**: ___

---

### Test 4: Diver Can Access and Complete Jobs Anytime
**Objective**: Verify that divers can open/close jobs regardless of due date

**Steps**:
1. Logged in as Riley Chen
2. Create a new job with a future due date (e.g., 2026-12-31)
3. Assign job to Riley
4. Riley should see the job immediately in their jobs list
5. Click to open the job detail
6. Try to mark the job complete

**Expected Result**:
- Job appears in Riley's jobs tab immediately (no due-date blocking)
- Job details can be opened and edited
- "Mark complete" button is available
- Can successfully submit completion

**Pass/Fail**: ___

---

### Test 5: Auto-Refresh After Job Completion (No Manual Refresh)
**Objective**: Verify that job lists update automatically after marking complete

**Steps**:
1. Logged in as Riley Chen
2. Open a job detail modal
3. Mark the job as complete (upload photo, add note)
4. Click "Mark completed" button
5. Modal closes and you're back at Jobs tab
6. **Do NOT refresh the page**
7. Observe the jobs list

**Expected Result**:
- Job automatically moves to "Finished" tab
- Completed job appears at the top of finished jobs
- No manual page refresh needed
- Job count updates automatically (e.g., "Unfinished 5" → "Unfinished 4")

**Pass/Fail**: ___

---

### Test 6: Auto-Refresh in Pay Tab After Job Completion
**Objective**: Verify that pay calculations update automatically

**Steps**:
1. Logged in as Riley Chen
2. Have Pay tab visible (or switch to it)
3. Complete a job with a price (e.g., $220)
4. Return to Pay tab (or navigate away and back)
5. **Do NOT refresh the page**
6. Observe the weekly total and daily breakdown

**Expected Result**:
- Weekly total updates with the new job earning (30% of $220 = $66)
- Daily breakdown shows the job in the completed date
- Updates appear automatically when switching tabs
- Numbers are accurate

**Pass/Fail**: ___

---

### Test 7: Admin (Sam) Still Has Full Access
**Objective**: Verify that admin users can still manage pricing and see all divers' pay

**Steps**:
1. Generate admin token: `node api/scripts/devtoken.mjs sam`
2. Log in as Sam Okafor (admin)
3. Navigate to Jobs tab - verify pricing displayed
4. Navigate to Pay tab
5. Select "Riley Chen" from the crew dropdown
6. View Riley's pay breakdown

**Expected Result**:
- Pricing visible in jobs
- Diver dropdown appears (requires PAY_VIEW_ALL)
- Can view any diver's pay history
- All features work as before

**Pass/Fail**: ___

---

### Test 8: Browser Focus Auto-Refresh
**Objective**: Verify that data refetches when switching browser tabs

**Steps**:
1. Logged in as Riley Chen in browser tab A
2. Open the same app in browser tab B (also as Riley)
3. In tab B, complete a job
4. Switch back to tab A
5. Observe without clicking anything

**Expected Result**:
- Data automatically refreshes when tab A regains focus
- Completed job appears in the finished list
- Pay numbers update
- No manual action required

**Pass/Fail**: ___

---

## Verification Checklist

- [ ] Diver token includes `JOBS_VIEW_PRICING` permission
- [ ] Job cards display price chips to divers
- [ ] Job detail modal shows price row to divers
- [ ] Pay tab displays weekly earnings to divers
- [ ] Divers can access jobs with future due dates
- [ ] Jobs update automatically after completion (no refresh needed)
- [ ] Pay totals update automatically after job completion
- [ ] Window focus triggers data refresh
- [ ] Admin still has PAY_VIEW_ALL access
- [ ] No console errors or API failures

## Debug Commands

**Generate tokens**:
```bash
cd api
node scripts/devtoken.mjs riley   # Diver
node scripts/devtoken.mjs sam     # Admin
```

**Check diver permissions**:
```bash
curl -s http://localhost:4310/api/me \
  -H 'Authorization: Bearer <DIVER_TOKEN>' | jq '.permissions'
```

**Expected diver permissions**:
```json
[
  "dive.jobs.view-assigned",
  "dive.jobs.complete",
  "dive.jobs.view-pricing",
  "dive.pay.view-own",
  "dive.inventory.view"
]
```

## Notes

- Jobs without a due date are always accessible
- Pricing is stripped from API response if diver lacks `JOBS_VIEW_PRICING`
- Pay calculations use 30% of job price (DIVER_PAY_RATE in code)
- Auto-refresh happens on window focus, after mutations via `reload()` call
