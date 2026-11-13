// Global State Storage
const bookingState = {
  fullName: '',
  age: '',
  email: '',
  phone: '',
  serviceType: '',
  selectedDate: '',
  selectedDayNum: '',
  selectedMonth: new Date().getMonth(),
  selectedYear: new Date().getFullYear(),
  selectedTime: '',
  specificService: '',
  placement: '',
  tattooSize: '',
  notes: '',
  paymentMethod: 'GCash',
  receiptFile: null,
  // Downscaled copy of the uploaded payment proof, sent to the studio so the
  // admin panel can actually display it (the file name alone is not proof).
  receiptImage: '',
  receiptReady: null,
  artist: 'Paulina Vampire',
  reference: '',
  confirmed: false,
  confirmedEmail: '',
  clientRequestId: '',
  emailSent: false,
  emailError: '',
  emailDeferred: false,
  emailStatusMessage: '',
  tattooFormType: 'standard',
  // Preview copy of the Custom Tattoo reference picture, sent to the studio.
  tattooReferenceImage: '',
  tattooReferenceReady: null,
  isSubmitting: false
};

// Track validation completion per step
const stepValidation = {
  details: false,
  datetime: false,
  payment: false
};

// The last confirmed booking is kept for the browser tab so a refresh does not
// silently disable the Review tab again.
const CONFIRMED_BOOKING_KEY = 'paulina.confirmedBooking.v1';
const PENDING_BOOKING_KEY = 'paulina.pendingBooking.v1';
const DELIVERY_POLL_INTERVAL_MS = 700;
const DELIVERY_POLL_ATTEMPTS = 8;
let deliveryPollActive = false;

function createClientRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return Array.from(window.crypto.getRandomValues(new Uint8Array(24)), value => value.toString(16).padStart(2, '0')).join('');
}

// Month names for calendar formatting
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// Current system date used as the default calendar position
function getToday() {
  const now = new Date();
  return { month: now.getMonth(), year: now.getFullYear(), day: now.getDate() };
}

// Pick the first time slot at or after the user's current system time
function getUpcomingTimeButton() {
  const buttons = Array.from(document.querySelectorAll('.time-btn'));
  if (!buttons.length) return null;

  const toMinutes = (label) => {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
    if (!match) return null;
    let hours = parseInt(match[1], 10) % 12;
    if (match[3].toUpperCase() === 'PM') hours += 12;
    return hours * 60 + parseInt(match[2], 10);
  };

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Round up to the next quarter-hour slot
  const roundedMinutes = Math.ceil(nowMinutes / 15) * 15;

  let upcoming = null;
  let upcomingMinutes = Infinity;
  buttons.forEach((btn) => {
    const minutes = toMinutes(btn.getAttribute('data-time') || btn.textContent.trim());
    if (minutes !== null && minutes >= roundedMinutes && minutes < upcomingMinutes) {
      upcoming = btn;
      upcomingMinutes = minutes;
    }
  });

  // Fall back to the first slot when the current time is past the last slot
  return upcoming || buttons[0];
}

// Show the selected time without implying the request is confirmed.
function updateSelectedDateText() {
  const statusEl = document.getElementById('selectedDateText');
  if (!statusEl) return;

  const today = getToday();
  const monthName = monthNames[bookingState.selectedMonth] || monthNames[today.month];
  const dayNum = bookingState.selectedDayNum || today.day;
  const timeStr = bookingState.selectedTime || '09:00 AM';
  statusEl.innerText = `Selected: ${monthName} ${dayNum} at ${timeStr}`;
  statusEl.classList.remove('error');
}

// Reset the calendar to the user's current month/day and nearest time slot
function setCalendarToNow() {
  const today = getToday();
  bookingState.selectedMonth = today.month;
  bookingState.selectedYear = today.year;
  bookingState.selectedDayNum = today.day;

  const monthYearSpan = document.getElementById('calendarMonthYear');
  if (monthYearSpan) {
    monthYearSpan.innerText = `${monthNames[today.month]} ${today.year}`;
  }

  const defaultTimeBtn = getUpcomingTimeButton();
  document.querySelectorAll('.time-btn').forEach(btn => btn.classList.remove('active-time'));
  if (defaultTimeBtn) {
    defaultTimeBtn.classList.add('active-time');
    bookingState.selectedTime = defaultTimeBtn.getAttribute('data-time') || defaultTimeBtn.textContent.trim();
  }

  generateCalendarDays(today.month, today.year);
  updateSelectedDateText();
  syncLockedTimeSlots();
}

// Keep the selected time slot visible inside the scrollable list.
// The grid scrolls on desktop; the whole time pane scrolls when stacked.
function scrollActiveTimeIntoView() {
  const activeTime = document.querySelector('.time-btn.active-time');
  const timeGrid = document.querySelector('.time-buttons-grid');
  if (!activeTime || !timeGrid) return;

  const container = timeGrid.scrollHeight > timeGrid.clientHeight + 1
    ? timeGrid
    : (timeGrid.closest('.time-pane') || timeGrid);
  if (!container.clientHeight) return;

  const btnRect = activeTime.getBoundingClientRect();
  const boxRect = container.getBoundingClientRect();
  if (btnRect.top < boxRect.top || btnRect.bottom > boxRect.bottom) {
    container.scrollTop = Math.max(0, container.scrollTop + btnRect.top - boxRect.top - 8);
  }
}

// Step Navigation Handler
function navigateToStep(stepId) {
  // Prevent navigation to disabled tabs
  const targetTab = document.getElementById(`tab-${stepId}`);
  if (targetTab && targetTab.disabled) {
    return;
  }

  // Review is only available once the booking has been confirmed by the server
  if (stepId === 'review') {
    const reviewTab = document.getElementById('tab-review');
    if (!bookingState.confirmed || (reviewTab && reviewTab.disabled)) {
      return;
    }

    try {
      populateReviewSummary();
    } catch (error) {
      // The tab switch must still happen even if one summary field fails.
      console.error('Could not populate the review summary:', error);
    }
  }
  
  // Update Navigation Tab Buttons
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  if (targetTab) {
    targetTab.classList.add('active');
  } else {
    console.error(`Tab button not found: tab-${stepId}`);
  }

  // Display Selected Step Panel
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  const targetContent = document.getElementById(`step-${stepId}`);
  if (targetContent) {
    targetContent.classList.add('active');
  } else {
    console.error(`Tab content not found: step-${stepId}`);
  }

  if (stepId === 'datetime') {
    scrollActiveTimeIntoView();
  }

  // Update Page Subtitle
  const subtitle = document.getElementById('stepSubtitle');
  if (subtitle) {
    if (stepId === 'details') {
      subtitle.innerText = "Tell us a little about yourself and the service you'd like to book.";
    } else if (stepId === 'datetime') {
      subtitle.innerText = "Choose your preferred date and available time slot.";
    } else if (stepId === 'payment') {
      subtitle.innerText = "Complete your booking request by making a deposit and uploading your payment receipt.";
    } else if (stepId === 'review') {
      subtitle.innerText = "Your booking request has been submitted! Our team will review your payment and confirm your appointment via email.";
    }
  }
}

// Studio policy — no appointment can be booked below this age.
const MINIMUM_AGE = 18;
const MINIMUM_AGE_MESSAGE =
  'Studio Policy: You must be at least 18 years old to book an appointment.';

// Age validation that runs while the client types and again on submit.
function validateAgeField() {
  const field = document.getElementById('age');
  if (!field) return true;

  const raw = field.value.trim();
  if (!raw) return true; // The submit validation owns the "required" message.

  const age = Number.parseInt(raw, 10);
  if (Number.isFinite(age) && age > 0 && age < MINIMUM_AGE) {
    showError('age', MINIMUM_AGE_MESSAGE);
    return false;
  }

  clearError('age');
  return true;
}

// Validation utility - show error for a field
function showError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (field) {
    const formGroup = field.closest('.form-group');
    const errorElement = formGroup?.querySelector('.field-error');
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.classList.add('show');
    }
    field.classList.add('error');
  } else {
    alert(message);
  }
}

// Validation utility - clear error for a field
function clearError(fieldId) {
  const field = document.getElementById(fieldId);
  if (field) {
    const formGroup = field.closest('.form-group');
    const errorElement = formGroup?.querySelector('.field-error');
    if (errorElement) {
      errorElement.textContent = '';
      errorElement.classList.remove('show');
    }
    field.classList.remove('error');
  }
}

// Validation utility - clear all errors
function clearAllErrors() {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('show');
  });
  document.querySelectorAll('.input-field.error').forEach(el => el.classList.remove('error'));
}

// Validate details step
function validateDetails() {
  clearAllErrors();
  let isValid = true;
  
  const fullName = document.getElementById('fullName').value.trim();
  if (!fullName) {
    showError('fullName', 'Please enter your full name.');
    isValid = false;
  }
  
  const age = document.getElementById('age').value.trim();
  if (!age) {
    showError('age', 'Please enter your age.');
    isValid = false;
  } else if (parseInt(age) < 1 || parseInt(age) > 120) {
    showError('age', 'Please enter a valid age.');
    isValid = false;
  } else if (parseInt(age) < MINIMUM_AGE) {
    // Studio policy: the studio only accepts clients who are 18 or older.
    showError('age', MINIMUM_AGE_MESSAGE);
    document.getElementById('age')?.focus();
    isValid = false;
  }
  
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showError('email', 'Please enter your email.');
    isValid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showError('email', 'Please enter a valid email address.');
    isValid = false;
  }
  
  const phone = document.getElementById('phone').value.trim();
  if (!phone) {
    showError('phone', 'Please enter your phone number.');
    isValid = false;
  } else if (!/^\d{10}$/.test(phone.replace(/\s+/g, ''))) {
    showError('phone', 'Please enter a valid 10-digit phone number.');
    isValid = false;
  }
  
  const serviceType = document.getElementById('serviceType').value;
  if (!serviceType) {
    showError('serviceType', 'Please select a service.');
    isValid = false;
  }
  
  return isValid;
}

// Validate datetime step
function validateDatetime() {
  const selectedDate = document.querySelector('.day.active-day');
  const selectedTime = document.querySelector('.time-btn.active-time');
  const statusEl = document.getElementById('selectedDateText');
  
  if (!selectedDate) {
    statusEl.innerText = 'Please select a date to proceed.';
    statusEl.classList.add('error');
    return false;
  }
  
  if (!selectedTime) {
    statusEl.innerText = 'Please select a time slot to proceed.';
    statusEl.classList.add('error');
    return false;
  }
  
  // Reset to normal styling
  statusEl.classList.remove('error');
  
  return true;
}

// Validate payment step
function validatePayment() {
  clearAllErrors();
  let isValid = true;
  
  // Validate based on service type
  if (bookingState.serviceType === 'Piercing') {
    const piercingType = document.getElementById('piercingType').value;
    if (!piercingType) {
      showError('piercingType', 'Please select a piercing type.');
      isValid = false;
    }
  } else if (bookingState.serviceType === 'Tattoo') {
    const tattooPlacement = document.getElementById('tattooPlacement').value;
    if (!tattooPlacement) {
      showError('tattooPlacement', 'Please select a placement.');
      isValid = false;
    }
    // The "Picture of Tattoo" upload is only required for the Custom Tattoo
    // Booking Form; the Standard Booking Form omits that field entirely.
    if (bookingState.tattooFormType === 'custom') {
      const tattooImageLabel = document.getElementById('tattooImageLabel');
      if (!tattooImageLabel || tattooImageLabel.innerText === 'Upload or Drag your document here') {
        isValid = false;
        tattooImageLabel.innerText = 'Please upload a picture of your tattoo.';
        tattooImageLabel.style.color = 'var(--input-field-error)';
      }
    }
  }

  // Validate payment method
  const paymentMethod = document.getElementById('paymentMethod').value;
  if (!paymentMethod) {
    showError('paymentMethod', 'Please select a payment method.');
    isValid = false;
  }
  
  // Validate proof of payment
  const receiptLabel = document.getElementById('receiptLabel');
  if (receiptLabel && receiptLabel.innerText === 'Upload or Drag your document here') {
    isValid = false;
    receiptLabel.innerText = 'Please upload your payment receipt.';
     receiptLabel.style.color = 'var(--input-field-error)';
  }
  
  return isValid;
}

// Validate and navigate to next step
async function validateAndNavigate(stepId) {
  let isValid = true;
  
  if (stepId === 'datetime') {
    // Save details before navigating
    syncBookingDetailsFromForm();
    
    isValid = validateDetails();
    if (isValid) {
      handleServiceTypeChange();
      stepValidation.details = true;
      // Unlock the Date & Time tab once the details are complete
      enableTab('tab-datetime');
    }
  }
  
  if (stepId === 'payment') {
    await syncLockedTimeSlots();
    if (!slotAvailabilityReady) return;
    // Validate datetime first
    isValid = validateDatetime();
    if (isValid) {
      let bookingServerAvailable = false;
      for (const endpoint of getBookingApiEndpoints('/api/health')) {
        try {
          const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
          if (response.ok && (await response.json()).success === true) {
            bookingServerAvailable = true;
            break;
          }
        } catch (_) { /* Try the next configured endpoint. */ }
      }
      if (!bookingServerAvailable) {
        const statusEl = document.getElementById('selectedDateText');
        if (statusEl) {
          statusEl.innerText = 'Online booking is unavailable right now. Please contact the studio before making a deposit.';
          statusEl.classList.add('error');
          statusEl.setAttribute('role', 'alert');
        }
        return;
      }
      // Save datetime before navigating
      const selectedDate = document.querySelector('.day.active-day');
      const selectedTime = document.querySelector('.time-btn.active-time');
      if (selectedDate) {
        const dayNum = selectedDate.textContent.trim();
        bookingState.selectedDayNum = dayNum;
        const monthName = monthNames[bookingState.selectedMonth] || 'June';
        bookingState.selectedDate = `${monthName} ${dayNum}, ${bookingState.selectedYear}`;
      }
      if (selectedTime) {
        bookingState.selectedTime = selectedTime.getAttribute('data-time') || selectedTime.textContent.trim();
      }
      stepValidation.datetime = true;
      // Unlock the Payment tab once the date & time are complete
      enableTab('tab-payment');
    }
  }
  
  if (isValid) {
    navigateToStep(stepId);
  }
}

// Validate and submit booking
function validateAndSubmit() {
  // The age policy is re-checked here so a value edited after step one can
  // never reach the server.
  syncBookingDetailsFromForm();
  if (!validateAgeField()) {
    const ageField = document.getElementById('age');
    if (ageField && Number.parseInt(ageField.value, 10) < MINIMUM_AGE) {
      showError('age', MINIMUM_AGE_MESSAGE);
      navigateToStep('details');
      ageField.focus();
      return;
    }
  }

  const isValid = validatePayment();
  
  if (isValid) {
    stepValidation.payment = true;
    submitBookingRequest();
  }
}

// Read the details step again so the confirmation always uses the latest
// values the customer entered (including a changed email address).
function syncBookingDetailsFromForm() {
  const readValue = (id) => document.getElementById(id)?.value.trim() || '';
  const localPhone = readValue('phone').replace(/\s+/g, '');

  bookingState.fullName = readValue('fullName');
  bookingState.age = readValue('age');
  bookingState.email = readValue('email');
  bookingState.phone = localPhone ? `+63 ${localPhone}` : bookingState.phone;
  bookingState.serviceType = document.getElementById('serviceType')?.value || '';

  return bookingState;
}

// Build the payload sent to the Express backend for persistence + Resend delivery
function buildBookingEmailPayload() {
  const serviceType = bookingState.serviceType;
  const tattooPlacement = document.getElementById('tattooPlacement');
  const tattooSize = document.getElementById('tattooSize');
  let notes = '';

  if (serviceType === 'Tattoo') {
    notes = document.getElementById('tattooNotes')?.value.trim() || '';
  } else if (serviceType === 'Troubleshooting') {
    notes = document.getElementById('troubleshootingNotes')?.value.trim() || '';
  } else {
    notes = document.getElementById('piercingNotes')?.value.trim() || '';
  }

  const isTattoo = serviceType === 'Tattoo';
  const isCustomTattoo = isTattoo && bookingState.tattooFormType === 'custom';

  return {
    fullName: bookingState.fullName,
    age: bookingState.age ? Number(bookingState.age) : null,
    email: bookingState.email,
    phone: bookingState.phone,
    serviceType,
    service: bookingState.specificService || serviceType,
    artist: bookingState.artist,
    date: bookingState.selectedDate,
    time: bookingState.selectedTime,
    placement: isTattoo ? (tattooPlacement?.value || '') : '',
    tattooSize: isTattoo ? (tattooSize?.value || '') : '',
    // Custom Tattoo details are what the admin Custom Requests page reads.
    tattooFormType: isTattoo ? bookingState.tattooFormType : '',
    tattooStyle: isTattoo ? (document.getElementById('tattooStyle')?.value || '') : '',
    tattooReferenceFileName: isCustomTattoo
      ? (document.getElementById('tattooImageInput')?.files?.[0]?.name || '')
      : '',
    tattooReferenceImage: isCustomTattoo ? bookingState.tattooReferenceImage || '' : '',
    notes,
    paymentMethod: document.getElementById('paymentMethod')?.value || bookingState.paymentMethod,
    receiptFileName: bookingState.receiptFile || '',
    receiptImage: bookingState.receiptImage || '',
    clientRequestId: bookingState.clientRequestId || ''
  };
}

// Accept localhost and private-network hosts so the booking page also works
// when it is opened through Live Server from another device on the LAN.
function isLocalOrPrivateHost(hostname) {
  if (!hostname) return false;
  const host = hostname.replace(/^\[|\]$/g, '');

  if (['localhost', '127.0.0.1', '::1'].includes(host)) return true;
  if (host.endsWith('.local')) return true;

  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
}

// Resolve the booking API. Same-origin is tried first so the Live Server proxy
// can forward /api to Express. When the page is opened as a static file or from
// another local port, fall back to the Express server on port 3000.
function getBookingApiEndpoints(path = '/api/send-booking-email') {
  const { protocol, hostname, port } = window.location;

  if (protocol === 'file:') {
    return [`http://127.0.0.1:3000${path}`];
  }

  const endpoints = [path];

  if (protocol === 'http:' && isLocalOrPrivateHost(hostname) && port !== '3000') {
    const directHost = hostname || '127.0.0.1';
    endpoints.push(`http://${directHost}:3000${path}`);

    if (directHost !== '127.0.0.1' && directHost !== 'localhost') {
      endpoints.push(`http://127.0.0.1:3000${path}`);
    }
  }

  return [...new Set(endpoints)];
}

// Send the booking to the backend, which stores it and dispatches the email
async function sendConfirmationEmail(payload) {
  if (!bookingState.email) {
    throw new Error('Please provide an email address for your confirmation.');
  }

  const endpoints = getBookingApiEndpoints();
  let lastError = null;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const isLastEndpoint = index === endpoints.length - 1;
    let response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      lastError = error;
      console.warn(`Booking API could not be reached at ${endpoint}:`, error);

      // A network error can mean the request was delivered but the response
      // was blocked. Do not retry on another endpoint because that could save
      // a duplicate booking; surface the failure instead.
      throw new Error(
        'We could not read the booking confirmation from the server. Your booking may still have been saved. ' +
          'Check your email for a confirmation before submitting again.'
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    // A static host such as Live Server answers unknown paths with a 404 HTML
    // page. That is not the booking API, so try the next endpoint. A 2xx HTML
    // response is also not the booking API.
    if (
      response.status === 404 ||
      (response.ok && !contentType.includes('application/json'))
    ) {
      lastError = new Error(`No booking API response at ${endpoint} (HTTP ${response.status}).`);
      console.warn(lastError.message, isLastEndpoint ? '' : 'Trying the next endpoint.');
      if (!isLastEndpoint) continue;
      break;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      lastError = error;
      if (!isLastEndpoint) {
        console.warn(`Booking API returned unreadable JSON at ${endpoint}. Trying the next endpoint.`);
        continue;
      }
      break;
    }

    if (!response.ok || !data.success) {
      const error = new Error(data.error || 'We could not save your booking.');
      error.httpStatus = response.status;
      throw error;
    }

    bookingState.reference = data.reference || '';
    bookingState.status = data.status || (data.confirmationDeferred ? 'pending_confirmation' : 'confirmed');
    bookingState.emailDeferred = Boolean(data.confirmationDeferred);
    bookingState.emailSent = Boolean(data.emailSent);
    bookingState.emailError = data.emailError || '';
    bookingState.emailStatusMessage = data.message || '';
    // The review screen always shows the address the customer typed, even if
    // the mail provider normalises it server-side.
    bookingState.confirmedEmail = payload.email || data.sentTo || '';

    return data;
  }

  console.error('Booking API could not be reached:', lastError);
  throw new Error(
    'We could not reach the booking service. Please try again shortly or contact the studio.'
  );
}

// Enable a specific tab button by its id (e.g. 'tab-datetime')
function enableTab(tabId) {
  const tab = document.getElementById(tabId);
  if (tab) {
    tab.disabled = false;
    tab.removeAttribute('aria-disabled');
    tab.removeAttribute('title');
    tab.classList.remove('review-ready');
  }
}

// Enable the Review tab once the backend has confirmed and stored the booking
function enableReviewTab() {
  const reviewTab = document.getElementById('tab-review');
  if (reviewTab) {
    reviewTab.disabled = false;
    reviewTab.classList.add('review-ready');
    reviewTab.setAttribute('aria-disabled', 'false');
    reviewTab.setAttribute('title', 'View your confirmed booking');
  }
}

// Disable the Review tab until a booking is confirmed
function disableReviewTab() {
  const reviewTab = document.getElementById('tab-review');
  if (reviewTab) {
    reviewTab.disabled = true;
    reviewTab.classList.remove('review-ready');
    reviewTab.setAttribute('aria-disabled', 'true');
    reviewTab.setAttribute('title', 'Confirm a booking to view the review');
  }
}

// Once a payment is confirmed (fresh submission or recovered after a reload),
// switch the customer straight to Review so they see the confirmation without
// having to click the tab manually. Returns whether Review became visible.
function showConfirmedReview() {
  stepValidation.payment = true;
  enableReviewTab();

  try {
    setEmailStatusNote(
      bookingState.confirmedEmail || bookingState.email,
      bookingState.emailSent,
      bookingState.emailError,
      bookingState.emailDeferred
    );
    populateReviewSummary();
  } catch (error) {
    console.error('Could not render the confirmed booking review:', error);
  }

  navigateToStep('review');

  const activePanel = document.querySelector('.tab-content.active');
  return Boolean(activePanel && activePanel.id === 'step-review');
}

// Format the saved appointment date the way the review card displays it
function getBookingDateLabel() {
  const monthIndex = Number(bookingState.selectedMonth);
  const dayNum = Number(bookingState.selectedDayNum);
  const year = Number(bookingState.selectedYear);

  if (
    Number.isInteger(monthIndex) && monthIndex >= 0 && monthIndex <= 11 &&
    Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31 &&
    Number.isInteger(year) && year > 1900
  ) {
    const date = new Date(year, monthIndex, dayNum);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    }
  }

  return bookingState.selectedDate || '—';
}

function setSummaryText(id, value, fallback = '—') {
  const element = document.getElementById(id);
  if (element) element.innerText = value || fallback;
}

// Display "+63 912 3456 789" instead of the raw 10-digit input
function formatPhoneForDisplay(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('63') ? digits.slice(2) : digits;

  if (local.length === 10) {
    return `+63 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }

  return phone || '';
}

// Match the "Piercing - Ear Piercing" style used in the review mockup while
// keeping the more descriptive tattoo and consultation labels intact.
function getServiceSummaryLabel() {
  const type = bookingState.serviceType;
  const specific = bookingState.specificService;

  if (!specific) return type;
  if (!type || type === 'Tattoo' || type === 'Troubleshooting') return specific;

  return specific.toLowerCase().startsWith(type.toLowerCase())
    ? specific
    : `${type} - ${specific}`;
}

// Fill the Review tab from the confirmed booking state. The email shown here is
// always the address the customer entered on the details step.
function populateReviewSummary() {
  const email =
    bookingState.confirmedEmail ||
    bookingState.email ||
    document.getElementById('email')?.value.trim() ||
    '';

  setSummaryText('sumDate', getBookingDateLabel());
  setSummaryText('sumTime', bookingState.selectedTime);
  setSummaryText('sumService', getServiceSummaryLabel());
  setSummaryText('sumName', bookingState.fullName);
  setSummaryText('sumEmail', email);
  setSummaryText('sumPhone', formatPhoneForDisplay(bookingState.phone));
  setSummaryText('noticeEmail', email);
  setSummaryText('sumReference', bookingState.reference, 'Pending');
}

function setEmailStatusNote(email, emailSent, emailError = '', deferred = false) {
  const note = document.getElementById('emailStatusNote');
  if (!note) return;

  // Every booking waits for the studio's decision, so no email is sent at
  // submission time and the note must not promise or report one.
  if (bookingState.status === 'cancelled') {
    note.textContent = ' Your booking request was declined or cancelled. Please contact the studio for details.';
    return;
  }
  if (deferred) {
    note.textContent =
      ' Your booking request is with the studio for review. ' +
      'We will email you once it is accepted or declined.';
    return;
  }

  if (emailSent === true) {
    note.textContent = ` A confirmation email has been sent to ${email}.`;
  } else if (emailSent === false && emailError) {
    note.textContent = ` Your booking is saved, but the confirmation email to ${email} could not be sent. Our studio will follow up by email.`;
  } else {
    // The booking is confirmed but the SMTP send has not finished yet. This
    // happens when the page reloads immediately after the booking is saved.
    note.textContent = ` Your booking is confirmed. We are sending the confirmation email to ${email}.`;
  }
}

// Keep the confirmed booking in this browser tab. Without this, a refresh
// resets bookingState and the Review tab becomes disabled again even though the
// booking and confirmation email were already completed.
function persistConfirmedBooking() {
  try {
    sessionStorage.setItem(
      CONFIRMED_BOOKING_KEY,
      JSON.stringify({
        version: 1,
        fullName: bookingState.fullName,
        email: bookingState.confirmedEmail || bookingState.email,
        phone: bookingState.phone,
        serviceType: bookingState.serviceType,
        specificService: bookingState.specificService,
        selectedMonth: bookingState.selectedMonth,
        selectedDayNum: bookingState.selectedDayNum,
        selectedYear: bookingState.selectedYear,
        selectedTime: bookingState.selectedTime,
        selectedDate: bookingState.selectedDate,
        reference: bookingState.reference,
        clientRequestId: bookingState.clientRequestId,
        status: bookingState.status || 'pending_confirmation',
        emailSent: bookingState.emailSent,
        emailError: bookingState.emailError || '',
        emailDeferred: bookingState.emailDeferred,
        emailStatusMessage: bookingState.emailStatusMessage
      })
    );
  } catch (error) {
    console.warn('Could not persist the confirmed booking state:', error);
  }
}

function clearConfirmedBooking() {
  try {
    sessionStorage.removeItem(CONFIRMED_BOOKING_KEY);
  } catch (error) {
    console.warn('Could not clear the confirmed booking state:', error);
  }
}

function restoreConfirmedBooking() {
  let saved = null;

  try {
    saved = JSON.parse(sessionStorage.getItem(CONFIRMED_BOOKING_KEY) || 'null');
  } catch (error) {
    console.warn('Could not read the confirmed booking state:', error);
    return false;
  }

  if (!saved || saved.version !== 1 || !saved.reference) return false;

  const email = String(saved.email || '').trim();
  const month = Number(saved.selectedMonth);
  const day = Number(saved.selectedDayNum);
  const year = Number(saved.selectedYear);

  bookingState.fullName = saved.fullName || '';
  bookingState.email = email;
  bookingState.confirmedEmail = email;
  bookingState.phone = saved.phone || '';
  bookingState.serviceType = saved.serviceType || '';
  bookingState.specificService = saved.specificService || '';
  bookingState.selectedTime = saved.selectedTime || '';
  bookingState.selectedDate = saved.selectedDate || '';
  bookingState.reference = saved.reference;
  bookingState.clientRequestId = saved.clientRequestId || '';
  bookingState.status = saved.status || 'pending_confirmation';
  bookingState.emailSent = Boolean(saved.emailSent);
  bookingState.emailError = saved.emailError || '';
  bookingState.emailDeferred = Boolean(saved.emailDeferred);
  bookingState.emailStatusMessage = saved.emailStatusMessage || '';
  bookingState.confirmed = true;

  if (Number.isInteger(month) && month >= 0 && month <= 11) bookingState.selectedMonth = month;
  if (Number.isInteger(day) && day >= 1 && day <= 31) bookingState.selectedDayNum = day;
  if (Number.isInteger(year) && year > 1900) bookingState.selectedYear = year;

  stepValidation.payment = true;
  enableReviewTab();

  // A refresh after a confirmed payment should land on Review, not leave the
  // customer on the payment/details step with an enabled-but-unopened tab.
  showConfirmedReview();

  return true;
}

// Written before the request starts. If the page reloads while the server is
// saving the booking, the token lets the page recover the confirmed booking.
function persistPendingBooking(payload) {
  try {
    sessionStorage.setItem(
      PENDING_BOOKING_KEY,
      JSON.stringify({
        version: 1,
        clientRequestId: payload.clientRequestId,
        email: payload.email,
        submittedAt: new Date().toISOString()
      })
    );
  } catch (error) {
    console.warn('Could not persist the pending booking state:', error);
  }
}

function readPendingBooking() {
  try {
    const pending = JSON.parse(sessionStorage.getItem(PENDING_BOOKING_KEY) || 'null');
    return pending && pending.version === 1 && pending.clientRequestId ? pending : null;
  } catch (error) {
    return null;
  }
}

function clearPendingBooking() {
  try {
    sessionStorage.removeItem(PENDING_BOOKING_KEY);
  } catch (error) {
    console.warn('Could not clear the pending booking state:', error);
  }
}

async function fetchBookingStatus(clientRequestId) {
  const path = `/api/bookings/status/${encodeURIComponent(clientRequestId)}`;
  const endpoints = getBookingApiEndpoints(path);

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Accept: 'application/json' }
      });
      const contentType = (response.headers.get('content-type') || '').toLowerCase();

      if (response.status === 404 && contentType.includes('application/json')) {
        return { found: false, booking: null };
      }

      if (!contentType.includes('application/json')) continue;

      const data = await response.json();
      if (!response.ok || !data.success) continue;

      return { found: Boolean(data.found), booking: data.booking || null };
    } catch (error) {
      console.warn(`Booking status could not be read at ${endpoint}:`, error);
    }
  }

  return null;
}

function applyRecoveredBooking(booking) {
  if (!booking || !booking.reference) return false;

  const email = String(booking.email || '').trim();
  const parsedDate = booking.date ? new Date(booking.date) : null;

  bookingState.fullName = booking.fullName || '';
  bookingState.email = email;
  bookingState.confirmedEmail = email;
  bookingState.phone = booking.phone || '';
  bookingState.serviceType = booking.serviceType || '';
  bookingState.specificService = booking.service || '';
  bookingState.selectedTime = booking.time || '';
  bookingState.selectedDate = booking.date || '';
  bookingState.paymentMethod = booking.paymentMethod || bookingState.paymentMethod;
  bookingState.reference = booking.reference;
  bookingState.status = booking.status || 'pending_confirmation';
  bookingState.emailDeferred = Boolean(booking.confirmationDeferred);
  bookingState.emailSent = Boolean(booking.emailSent);
  bookingState.emailError = booking.emailError || '';
  bookingState.emailStatusMessage = '';
  bookingState.confirmed = true;

  if (parsedDate && !Number.isNaN(parsedDate.getTime())) {
    bookingState.selectedMonth = parsedDate.getMonth();
    bookingState.selectedDayNum = parsedDate.getDate();
    bookingState.selectedYear = parsedDate.getFullYear();
  }

  stepValidation.payment = true;
  enableReviewTab();

  persistConfirmedBooking();

  // Recovered submissions were confirmed by the server, so reveal the Review
  // tab automatically just like a normal successful confirmation.
  showConfirmedReview();

  return true;
}

// The status endpoint can answer while the SMTP send is still running. Poll a
// few times so the Review note changes from "sending" to sent/failed instead of
// being stuck on a stale emailSent:false.
async function refreshRecoveredDelivery(clientRequestId) {
  // Deferred requests have no delivery in flight; they are emailed only after
  // the studio accepts or declines them.
  if (deliveryPollActive || bookingState.emailDeferred) return;
  deliveryPollActive = true;

  try {
    for (let attempt = 0; attempt < DELIVERY_POLL_ATTEMPTS; attempt += 1) {
      if (!readPendingBooking()) return;

      const result = await fetchBookingStatus(clientRequestId);

      if (result && result.found && result.booking) {
        const booking = result.booking;

        if (
          booking.reference === bookingState.reference &&
          (booking.emailSent || booking.emailError)
        ) {
          bookingState.emailSent = Boolean(booking.emailSent);
          bookingState.emailError = booking.emailError || '';
          setEmailStatusNote(
            bookingState.confirmedEmail || booking.email,
            bookingState.emailSent,
            bookingState.emailError
          );
          persistConfirmedBooking();
          clearPendingBooking();
          return;
        }
      }

      await new Promise((resolve) => {
        setTimeout(resolve, DELIVERY_POLL_INTERVAL_MS);
      });
    }
  } finally {
    deliveryPollActive = false;
  }
}

async function recoverPendingBooking() {
  const pending = readPendingBooking();
  if (!pending) return false;

  const result = await fetchBookingStatus(pending.clientRequestId);

  // A network failure is inconclusive. Keep the token so the next reload can
  // try again instead of losing the only link to the saved booking.
  if (result === null) return false;

  if (!result.found || !result.booking) {
    clearPendingBooking();
    return false;
  }

  const applied = applyRecoveredBooking(result.booking);
  if (!applied) return false;

  if (
    result.booking.confirmationDeferred ||
    result.booking.emailSent ||
    result.booking.emailError
  ) {
    clearPendingBooking();
  } else {
    // Keep the token until delivery resolves; the poll and the next page load
    // both use it.
    refreshRecoveredDelivery(pending.clientRequestId);
  }

  return true;
}

// Restore the admin-managed studio photo for the booking sidebar. The published
// image is cached by js/site-content.js; the local asset is only a fallback.
function resetSideImage() {
   const sideImg = document.getElementById('sideDisplayImage');
   if (!sideImg) return;
   sideImg.src = sideImg.dataset.siteImageSrc || "../../assets/images/stud_1.png";
}

// Toggle Piercing vs Tattoo Specific Form Fields
function handleServiceTypeChange() {
   const type = document.getElementById('serviceType').value;
   bookingState.serviceType = type;

   const piercingFields = document.getElementById('piercingPaymentFields');
   const tattooFields = document.getElementById('tattooPaymentFields');
   const troubleshootingFields = document.getElementById('troubleshootingPaymentFields');
   const sideImg = document.getElementById('sideDisplayImage');

   // Keep the studio artwork published from the admin dashboard.
   resetSideImage();

   if (type === 'Tattoo') {
     piercingFields.classList.add('hidden-field');
     tattooFields.classList.remove('hidden-field');
     troubleshootingFields.classList.add('hidden-field');

     // Restore the previously chosen tattoo booking form type (defaults to
     // Standard). This keeps the user's selection when they navigate away and
     // back, while hiding the "Picture of Tattoo" field for the Standard form.
     if (!bookingState.tattooFormType || !['standard', 'custom'].includes(bookingState.tattooFormType)) {
       bookingState.tattooFormType = 'standard';
     }
     selectTattooFormType(bookingState.tattooFormType);
   } else if (type === 'Troubleshooting') {
     piercingFields.classList.add('hidden-field');
     tattooFields.classList.add('hidden-field');
     troubleshootingFields.classList.remove('hidden-field');
   } else {
     piercingFields.classList.remove('hidden-field');
     tattooFields.classList.add('hidden-field');
     troubleshootingFields.classList.add('hidden-field');
   }

   // Fallback to a reliable local image if the assigned src fails to load
   sideImg.onerror = function() {
     sideImg.src = "../../assets/images/stud_1.png";
     sideImg.onerror = null;
   };
}

// Switch between the "Standard Booking Form" and "Custom Tattoo Booking Form"
// options shown at the top of the Payment tab when Tattoo is the service.
function selectTattooFormType(type) {
   if (type !== 'standard' && type !== 'custom') {
     type = 'standard';
   }
   bookingState.tattooFormType = type;

   const buttons = document.querySelectorAll('.tattoo-form-type-btn');
   buttons.forEach((btn) => {
     btn.classList.toggle('active', btn.getAttribute('data-form-type') === type);
   });

   // The style and "Picture of Tattoo" fields are exclusive to the Custom form.
   const imageField = document.getElementById('tattooImageField');
   if (imageField) {
     imageField.classList.toggle('hidden-field', type !== 'custom');
   }

   const styleField = document.getElementById('tattooStyleField');
   if (styleField) {
     styleField.classList.toggle('hidden-field', type !== 'custom');
   }
}

// Calendar Date Selector
function selectCalendarDay(element, dayNum) {
  document.querySelectorAll('.day').forEach(d => d.classList.remove('active-day'));
  element.classList.add('active-day');
  bookingState.selectedDayNum = dayNum;
  
  const monthName = monthNames[bookingState.selectedMonth] || 'June';
  bookingState.selectedDate = `${monthName} ${dayNum}, ${bookingState.selectedYear}`;

  updateSelectedDateText();
  syncLockedTimeSlots();
}

/**
 * Programmatically disables/locks time slots that have already reached 'Confirmed' status
 * to prevent double-booking and concurrency conflicts.
 */
let slotRequestId = 0;
let slotAvailabilityReady = false;

async function syncLockedTimeSlots() {
  const dateStr = bookingState.selectedDate;
  if (!dateStr) return;
  const requestId = ++slotRequestId;
  slotAvailabilityReady = false;

  const artist = bookingState.artist || '';
  try {
    const url = window.paulinaApiUrl(`/api/bookings/locked-slots?date=${encodeURIComponent(dateStr)}&artist=${encodeURIComponent(artist)}`);
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.lockedSlots)) throw new Error('Availability is unavailable.');
    const lockedTimes = data.lockedSlots.map(value => value.trim().toLowerCase());

    if (requestId !== slotRequestId) return;
    slotAvailabilityReady = true;
    const timeButtons = Array.from(document.querySelectorAll('.time-btn'));
    let currentActiveIsLocked = false;

    timeButtons.forEach((btn) => {
      const btnTime = (btn.getAttribute('data-time') || btn.textContent.trim()).toLowerCase();
      const isLocked = lockedTimes.includes(btnTime);

      if (isLocked) {
        btn.disabled = true;
        btn.classList.add('is-locked');
        btn.setAttribute('title', 'Slot already booked');
        if (btn.classList.contains('active-time')) {
          currentActiveIsLocked = true;
          btn.classList.remove('active-time');
        }
      } else {
        btn.disabled = false;
        btn.classList.remove('is-locked');
        btn.removeAttribute('title');
      }
    });

    if (currentActiveIsLocked) {
      const firstAvailable = timeButtons.find((btn) => !btn.disabled);
      if (firstAvailable) {
        firstAvailable.classList.add('active-time');
        bookingState.selectedTime = firstAvailable.getAttribute('data-time') || firstAvailable.textContent.trim();
        updateSelectedDateText();
      } else {
        bookingState.selectedTime = '';
        const statusEl = document.getElementById('selectedDateText');
        if (statusEl) {
          statusEl.innerText = `All slots on ${dateStr} are confirmed. Please choose another date.`;
          statusEl.classList.add('error');
        }
      }
    }
  } catch (error) {
    if (requestId !== slotRequestId) return;
    const statusEl = document.getElementById('selectedDateText');
    if (statusEl) { statusEl.innerText = 'Availability could not be checked. Please retry shortly.'; statusEl.classList.add('error'); }
    console.warn('[booking] Could not synchronize locked slots:', error);
  }
}

// Time Slot Selector
function selectTimeSlot(element, timeStr) {
  document.querySelectorAll('.time-btn').forEach(t => t.classList.remove('active-time'));
  element.classList.add('active-time');
  bookingState.selectedTime = timeStr;

  updateSelectedDateText();
}

// The studio only needs a preview-quality copy of the reference picture, so it
// is scaled down in the browser before it travels with the booking request.
const REFERENCE_IMAGE_MAX_EDGE = 1280;
const REFERENCE_IMAGE_QUALITY = 0.82;
const REFERENCE_IMAGE_PASSTHROUGH_BYTES = 400 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('The picture could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The picture could not be decoded.'));
    image.src = source;
  });
}

async function buildReferencePreview(file) {
  const original = await readFileAsDataUrl(file);

  // Small pictures are sent untouched unless they still need scaling down.
  if (file.size <= REFERENCE_IMAGE_PASSTHROUGH_BYTES) {
    try {
      const image = await loadImageElement(original);
      if (Math.max(image.width, image.height) <= REFERENCE_IMAGE_MAX_EDGE) return original;
    } catch {
      return original;
    }
  }

  const image = await loadImageElement(original);
  const scale = Math.min(1, REFERENCE_IMAGE_MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', REFERENCE_IMAGE_QUALITY);
}

// File Upload Label Display
function handleFileChange(input, labelId) {
  const label = document.getElementById(labelId);
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];

  if (label) {
    label.innerText = `Selected: ${file.name}`;
    label.style.color = '';
  }

  // Payment proof: prepare the image up front so submitting never stalls on it.
  if (input.id === 'receiptInput') {
    bookingState.receiptImage = '';
    bookingState.receiptReady = buildReferencePreview(file)
      .then((preview) => {
        bookingState.receiptImage = preview;
        return preview;
      })
      .catch((error) => {
        console.warn('[booking] Payment receipt could not be prepared:', error.message);
        return '';
      });
    return;
  }

  if (input.id !== 'tattooImageInput') return;

  // Prepare the reference picture now so submitting does not stall on it.
  bookingState.tattooReferenceImage = '';
  bookingState.tattooReferenceReady = buildReferencePreview(file)
    .then((preview) => {
      bookingState.tattooReferenceImage = preview;
      return preview;
    })
    .catch(async (error) => {
      console.warn('[booking] Reference picture could not be prepared:', error.message);
      try {
        const raw = await readFileAsDataUrl(file);
        if (/^data:image\/(png|jpe?g|webp);base64,/i.test(raw)) {
          bookingState.tattooReferenceImage = raw;
          return raw;
        }
      } catch {
        /* ignore */
      }
      return '';
    });
}

// Submit Booking & Populate Summary
async function submitBookingRequest() {
  if (bookingState.isSubmitting) return;

  // A booking is already confirmed; take the customer back to its review
  // instead of creating a duplicate record.
  if (bookingState.confirmed) {
    populateReviewSummary();
    navigateToStep('review');
    return;
  }

  bookingState.isSubmitting = true;

  // The reference picture is downscaled in the background. Waiting here keeps
  // the studio from receiving a request without the artwork it needs.
  if (bookingState.tattooReferenceReady) {
    await bookingState.tattooReferenceReady;
    bookingState.tattooReferenceReady = null;
  }

  // The picture must travel with the request: a file name alone leaves the
  // admin panel with nothing to display.
  const referenceInput = document.getElementById('tattooImageInput');
  const selectedReference = referenceInput?.files?.[0] || null;
  if (
    bookingState.serviceType === 'Tattoo' &&
    bookingState.tattooFormType === 'custom' &&
    selectedReference &&
    !bookingState.tattooReferenceImage
  ) {
    bookingState.tattooReferenceImage = await buildReferencePreview(selectedReference).catch(() => '');
    if (!bookingState.tattooReferenceImage) {
      bookingState.isSubmitting = false;
      alert('Your reference picture could not be read. Please re-select it as a JPG, PNG or WebP image.');
      return;
    }
  }

  // Make sure the confirmation uses the details currently in the form.
  syncBookingDetailsFromForm();

  if (bookingState.serviceType === 'Piercing') {
    const subType = document.getElementById('piercingType').value;
    bookingState.specificService = subType || 'Piercing';
   } else if (bookingState.serviceType === 'Tattoo') {
     const placement = document.getElementById('tattooPlacement').value;
     const size = document.getElementById('tattooSize').value;
     const sizeLabel = size.split(' ')[0];
     if (bookingState.tattooFormType === 'custom') {
       bookingState.specificService = `Custom Tattoo - ${placement} (${sizeLabel})`;
     } else {
       bookingState.specificService = `Standard Tattoo Booking - ${placement} (${sizeLabel})`;
     }
   } else if (bookingState.serviceType === 'Troubleshooting') {
    bookingState.specificService = 'Troubleshooting / Aftercare Consultation';
  } else {
    bookingState.specificService = bookingState.serviceType || 'Studio Appointment';
  }

  // Capture receipt file and the latest payment method selection
  const receiptInput = document.getElementById('receiptInput');
  bookingState.receiptFile = receiptInput?.files?.[0]?.name || '';

  // The proof of payment travels with the request so the studio can check it.
  if (bookingState.receiptReady) {
    await bookingState.receiptReady;
    bookingState.receiptReady = null;
  }
  if (receiptInput?.files?.[0] && !bookingState.receiptImage) {
    bookingState.receiptImage = await buildReferencePreview(receiptInput.files[0]).catch(() => '');
  }
  if (receiptInput?.files?.[0] && !bookingState.receiptImage) {
    bookingState.isSubmitting = false;
    alert('Your payment receipt could not be read. Please upload it again as a JPG, PNG or WebP image.');
    return;
  }
  bookingState.paymentMethod =
    document.getElementById('paymentMethod')?.value || bookingState.paymentMethod;

  // Reuse the same token for a retry; generate one for a fresh submission.
  // The server uses it to make submission idempotent and the page uses it to
  // recover the booking if the response never arrives.
  if (!bookingState.clientRequestId) {
    bookingState.clientRequestId = createClientRequestId();
  }

  // Remember the address the customer entered for this confirmed booking
  const emailPayload = buildBookingEmailPayload();
  bookingState.confirmedEmail = emailPayload.email;

  // Persist before the request so a reload during submission can recover it.
  persistPendingBooking(emailPayload);

  const referenceEl = document.getElementById('sumReference');
  if (referenceEl) referenceEl.innerText = 'Generating...';

  const emailStatusNote = document.getElementById('emailStatusNote');
  if (emailStatusNote) emailStatusNote.textContent = '';

  const submitButton = document.querySelector('#step-payment .btn-primary');
  const originalButtonText = submitButton ? submitButton.textContent : '';
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'SENDING...';
  }

  // Save the booking request. The confirmation email is only sent after the
  // studio accepts it, so nothing is mailed from this screen.
  sendConfirmationEmail(emailPayload)
    .then((result) => {
      bookingState.reference = result.reference || '';
      bookingState.confirmed = true;
      bookingState.confirmedEmail = emailPayload.email || result.sentTo || bookingState.confirmedEmail;

      // Unlock Review as soon as the booking is confirmed by the server. Email
      // delivery status must not control whether the review is available.
      stepValidation.payment = true;
      enableReviewTab();
      persistConfirmedBooking();
      clearPendingBooking();

      if (referenceEl) {
        referenceEl.innerText = bookingState.reference || 'Pending studio confirmation';
      }

      if (!showConfirmedReview()) {
        console.error('Booking was saved, but the review screen could not be activated.');
        alert(
          `Your booking was saved with reference ${bookingState.reference || 'pending'}, but the review screen could not be displayed. ` +
            'Please click the Review tab or refresh the page.'
        );
      }
    })
    .catch((error) => {
      console.error('Failed to submit booking:', error);

      // A 4xx means the server definitely rejected the booking, so there is
      // nothing to recover. Network and 5xx errors may still have saved it.
      if (error.httpStatus >= 400 && error.httpStatus < 500) {
        clearPendingBooking();
        bookingState.clientRequestId = '';
  bookingState.status = 'pending_confirmation';
      }

      if (referenceEl) referenceEl.innerText = 'Not confirmed';
      alert(`${error.message}\n\nNeed help? Email faye08022005@gmail.com.`);
    })
    .finally(() => {
      bookingState.isSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    });
}

// Reset Form Flow
function startNewBooking() {
  document.getElementById('fullName').value = '';
  document.getElementById('age').value = '';
  document.getElementById('email').value = '';
  document.getElementById('phone').value = '';
  document.getElementById('serviceType').value = '';
  document.getElementById('piercingType').selectedIndex = 0;
  document.getElementById('tattooPlacement').selectedIndex = 0;
  document.getElementById('tattooSize').selectedIndex = 0;
  document.getElementById('piercingNotes').value = '';
  document.getElementById('tattooNotes').value = '';
  document.getElementById('troubleshootingNotes').value = '';
  document.getElementById('paymentMethod').value = 'GCash';
  document.getElementById('tattooImageLabel').innerText = 'Upload or Drag your document here';
  document.getElementById('tattooImageLabel').style.color = '';
  document.getElementById('receiptLabel').innerText = 'Upload or Drag your document here';
  document.getElementById('receiptLabel').style.color = '';
  
  clearAllErrors();
  
  bookingState.fullName = '';
  bookingState.age = '';
  bookingState.email = '';
  bookingState.phone = '';
  bookingState.serviceType = '';
  bookingState.selectedDayNum = '';
  bookingState.selectedDate = '';
  bookingState.selectedTime = '';
   bookingState.specificService = '';
   bookingState.reference = '';
   bookingState.tattooFormType = 'standard';
   bookingState.confirmed = false;
  bookingState.confirmedEmail = '';
  bookingState.emailSent = false;
  bookingState.emailError = '';
  bookingState.emailDeferred = false;
  bookingState.emailStatusMessage = '';
  bookingState.isSubmitting = false;
  bookingState.paymentMethod = 'GCash';
  bookingState.clientRequestId = '';

  ['sumDate', 'sumTime', 'sumService', 'sumName', 'sumEmail', 'sumPhone', 'noticeEmail']
    .forEach((id) => setSummaryText(id, ''));
  setSummaryText('sumReference', '', 'Pending');
  const emailStatusNote = document.getElementById('emailStatusNote');
  if (emailStatusNote) emailStatusNote.textContent = '';
  
  stepValidation.details = false;
  stepValidation.datetime = false;
  stepValidation.payment = false;

  clearConfirmedBooking();
  clearPendingBooking();
  
  // Reset calendar selections
  document.querySelectorAll('.day').forEach(d => d.classList.remove('active-day'));
  document.querySelectorAll('.time-btn').forEach(t => t.classList.remove('active-time'));
  
  // Reset calendar to the current month/day and nearest available time slot
  if (document.getElementById('calendarMonthYear')) {
    setCalendarToNow();
  }
  
  // Restore the published studio artwork (or the local fallback).
  resetSideImage();
  
  disableReviewTab();
  navigateToStep('details');
}

// Calendar Month Navigation
function changeMonth(direction) {
  const monthYearSpan = document.getElementById('calendarMonthYear');
  if (!monthYearSpan) return;
  
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentText = monthYearSpan.innerText;
  const parts = currentText.split(' ');
  let currentMonthIndex = months.indexOf(parts[0]);
  let currentYear = parseInt(parts[1]);
  
  let newMonthIndex = currentMonthIndex + direction;
  let newYear = currentYear;
  
  if (newMonthIndex < 0) {
    newMonthIndex = 11;
    newYear -= 1;
  } else if (newMonthIndex > 11) {
    newMonthIndex = 0;
    newYear += 1;
  }
  
  monthYearSpan.innerText = `${months[newMonthIndex]} ${newYear}`;
  
  // Update selectedMonth and selectedYear
  bookingState.selectedMonth = newMonthIndex;
  bookingState.selectedYear = newYear;
  
  // Rebuild calendar grid for the new month
  generateCalendarDays(newMonthIndex, newYear);
}

// Generate calendar days for a given month and year
function generateCalendarDays(monthIndex, year) {
  const calendarGrid = document.querySelector('.calendar-grid');
  if (!calendarGrid) return;
  
  // Get the day name headers (first 7 children)
  const dayNames = calendarGrid.querySelectorAll('.day-name');
  
  // Calculate first day of month and total days
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  
  // Clear existing day cells (everything after day names)
  let dayCell = calendarGrid.querySelector('.day');
  while (dayCell) {
    const next = dayCell.nextElementSibling;
    calendarGrid.removeChild(dayCell);
    dayCell = next;
  }
  
  // Add empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'day empty';
    calendarGrid.appendChild(emptyCell);
  }
  
  // Add day cells
  const today = getToday();
  for (let day = 1; day <= daysInMonth; day++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'day';
    dayCell.textContent = day;
    dayCell.setAttribute('data-day', day);
    dayCell.setAttribute('data-month', monthIndex);
    dayCell.setAttribute('data-year', year);
    
    // Pre-select today when the current month is displayed
    if (day === today.day && monthIndex === today.month && year === today.year) {
      dayCell.classList.add('active-day');
      bookingState.selectedDayNum = today.day;
      bookingState.selectedMonth = today.month;
      bookingState.selectedYear = today.year;
    }
    
    // Add click handler for selection
    dayCell.addEventListener('click', function() {
      selectCalendarDay(this, day);
    });
    
    calendarGrid.appendChild(dayCell);
  }

  if (calendarGrid.querySelector('.day.active-day')) {
    updateSelectedDateText();
  }
}

// Initialize page on load
// Payment QR codes live in assets/images and are branded cards per method. The
// dashboard can publish a replacement for any of them; site-content.js caches
// those on the QR image, so a published card wins over the bundled artwork.
const PAYMENT_QR_IMAGES = {
  GCash: { fallback: '../../assets/images/qr-gcash.jpeg', publishedKey: 'siteQrGcashSrc' },
  Maya: { fallback: '../../assets/images/qr-maya.jpeg', publishedKey: 'siteQrMayaSrc' },
  BPI: { fallback: '../../assets/images/qr-bpi.jpeg', publishedKey: 'siteQrBpiSrc' },
  GoTyme: { fallback: '../../assets/images/qr-gotyme.jpeg', publishedKey: 'siteQrGotymeSrc' },
  Maribank: { fallback: '../../assets/images/qr-maribank.jpeg', publishedKey: 'siteQrMaribankSrc' }
};

const qrSlug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Deposit instructions shown beside the QR code in the mobile modal.
const PAYMENT_QR_INSTRUCTIONS = {
  GCash:
    'Open GCash, tap Send Money \u2192 Scan QR, then send the \u20B1500 deposit. Save this QR image to your gallery so you can upload it in the GCash app.',
  Maya:
    'Open Maya, tap Send Money \u2192 Scan QR, then send the \u20B1500 deposit. Save this QR image to your gallery so you can upload it in the Maya app.',
  GoTyme:
    'Open the GoTyme Bank app, choose Transfer \u2192 Scan QR, then send the \u20B1500 deposit. Save this QR image first, then upload it in the app.',
  BPI:
    'Open the BPI app, choose Transfer \u2192 QR, then send the \u20B1500 deposit. Save this QR image first so you can upload it in your banking app.',
  Maribank:
    'Open the Maribank app, choose Transfer \u2192 Scan QR, then send the \u20B1500 deposit. Save this QR image first, then upload it in the app.'
};

const DEFAULT_QR_INSTRUCTIONS =
  'Scan this QR code in your bank or e-wallet app and send the \u20B1500 deposit, then upload the receipt on this page.';

function qrEntryFor(method) {
  return (
    Object.entries(PAYMENT_QR_IMAGES).find(([name]) => qrSlug(name) === qrSlug(method)) || null
  );
}

/** Resolves the active QR artwork: admin-published image first, bundled fallback second. */
function resolveQrAsset(entry) {
  const image = document.getElementById('paymentQrImage');
  if (!entry) return null;

  const [name, { fallback, publishedKey }] = entry;
  const altKey = publishedKey.replace(/Src$/, 'Alt');
  const published = image?.dataset[publishedKey] || '';

  return {
    name,
    source: published || fallback,
    alt: (published && image?.dataset[altKey]) || `${name} QR code`
  };
}

function updatePaymentQr() {
  const select = document.getElementById('paymentMethod');
  const image = document.getElementById('paymentQrImage');

  if (!select || !image) return;

  const asset = resolveQrAsset(qrEntryFor(select.value));
  if (!asset?.source) return;

  if (image.getAttribute('src') !== asset.source) {
    image.setAttribute('src', asset.source);
  }
  image.alt = asset.alt;

  const modalImage = document.getElementById('qrModalImage');
  const modalTitle = document.getElementById('qrModalTitle');
  const modalCopy = document.getElementById('qrModalInstructions');

  if (modalImage) {
    modalImage.src = asset.source;
    modalImage.alt = asset.alt;
  }
  if (modalTitle) modalTitle.textContent = `${asset.name} QR code`;
  if (modalCopy) {
    modalCopy.textContent = PAYMENT_QR_INSTRUCTIONS[asset.name] || DEFAULT_QR_INSTRUCTIONS;
  }
}

/* -------------------------------------------------------------------------
   SAVE / DOWNLOAD QR CODE
   The QR may live in Supabase Storage (another origin), where the download
   attribute is ignored. It is fetched as a blob first, with a canvas export
   fallback, so the saved file lands in the device gallery/downloads.
   ------------------------------------------------------------------------- */

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function flashQrButtons(label) {
  document.querySelectorAll('[data-qr-download]').forEach((button) => {
    if (button.dataset.originalLabel === undefined) {
      button.dataset.originalLabel = button.innerHTML;
    }
    button.textContent = label;
    window.setTimeout(() => {
      if (button.dataset.originalLabel !== undefined) {
        button.innerHTML = button.dataset.originalLabel;
      }
    }, 2400);
  });
}

async function downloadQrCode() {
  const select = document.getElementById('paymentMethod');
  const asset = resolveQrAsset(qrEntryFor(select?.value));
  if (!asset?.source) return;

  const fileName = `${qrSlug(asset.name) || 'deposit'}-deposit-qr.png`;

  try {
    const response = await fetch(asset.source, { mode: 'cors', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    triggerBlobDownload(await response.blob(), fileName);
    flashQrButtons('QR saved');
    return;
  } catch (error) {
    console.warn('[booking] Direct QR download failed, trying canvas export:', error.message);
  }

  try {
    const image = await loadImageElement(asset.source);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    context.drawImage(image, 0, 0);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The QR image could not be exported.');

    triggerBlobDownload(blob, fileName);
    flashQrButtons('QR saved');
  } catch (error) {
    console.warn('[booking] QR download fallback failed:', error.message);
    // Last resort: open the QR on its own so it can be long-pressed and saved.
    window.open(asset.source, '_blank', 'noopener');
    flashQrButtons('Press and hold to save');
  }
}

/* -------------------------------------------------------------------------
   MOBILE QR MODAL
   Inline QR codes are hidden below 768px. Selecting a payment method opens
   this dialog; it is never opened automatically on page load.
   ------------------------------------------------------------------------- */

function isMobileBookingViewport() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function openQrModal() {
  const modal = document.getElementById('qrModal');
  if (!modal) return;

  updatePaymentQr();
  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.getElementById('qrModalClose')?.focus({ preventScroll: true });
}

function closeQrModal() {
  const modal = document.getElementById('qrModal');
  if (!modal) return;

  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.style.overflow = '';
  }
  document.getElementById('openQrModal')?.blur();
}

function initPaymentQr() {
  const select = document.getElementById('paymentMethod');
  if (!select) return;

  select.addEventListener('change', () => {
    updatePaymentQr();
    // On phones the QR lives in the modal instead of inline on the page.
    if (isMobileBookingViewport()) openQrModal();
  });
  updatePaymentQr();

  document.addEventListener('paulina:content-updated', () => {
    resetSideImage();
    updatePaymentQr();
  });

  document.getElementById('openQrModal')?.addEventListener('click', openQrModal);
  document.getElementById('qrModalClose')?.addEventListener('click', (event) => {
    event.stopPropagation();
    closeQrModal();
  });

  const modal = document.getElementById('qrModal');
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeQrModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal?.classList.contains('active')) closeQrModal();
  });

  document.querySelectorAll('[data-qr-download]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      downloadQrCode();
    });
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initPaymentQr();
  // Set initial image (admin-published artwork when available).
  resetSideImage();
  
  // Disable Review tab initially
  disableReviewTab();
  
  // Initialize calendar with the user's current month/day and nearest time slot
  if (document.getElementById('calendarMonthYear')) {
    setCalendarToNow();
  }

  // Re-enable Review when this browser tab already has a confirmed booking,
  // even if the page was refreshed after the confirmation email arrived.
  restoreConfirmedBooking();

  // If the page reloaded while a submission was still in flight, ask the server
  // whether that request was saved and refresh the email delivery result.
  recoverPendingBooking();
  
  // Add input event listeners for real-time validation
  const inputs = ['fullName', 'age', 'email', 'phone'];
  inputs.forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', function() {
        clearError(id);
      });
    }
  });

  // Real-time under-18 policy check on the age field.
  document.getElementById('age')?.addEventListener('input', validateAgeField);
  document.getElementById('age')?.addEventListener('blur', validateAgeField);
  
  // Service type change listener
  const serviceSelect = document.getElementById('serviceType');
  if (serviceSelect) {
    serviceSelect.addEventListener('change', function() {
      clearError('serviceType');
    });
  }
  
  // Add click handlers for time slots
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      selectTimeSlot(this, this.getAttribute('data-time') || this.textContent.trim());
    });
  });
});

// Restoring from the back/forward cache does not fire DOMContentLoaded, so
// rehydrate the confirmed booking here as well.
window.addEventListener('pageshow', function(event) {
  if (!event.persisted) return;
  restoreConfirmedBooking();
  recoverPendingBooking();
});

// Follow the reviewed booking across separate serverless instances.
let statusRefreshActive = false;
window.setInterval(async () => {
  if (document.hidden || !bookingState.confirmed || !bookingState.clientRequestId || statusRefreshActive) return;
  statusRefreshActive = true;
  try {
    const result = await fetchBookingStatus(bookingState.clientRequestId);
    if (result?.found && result.booking?.reference === bookingState.reference) {
      bookingState.status = result.booking.status;
      bookingState.selectedTime = result.booking.time || bookingState.selectedTime;
      bookingState.selectedDate = result.booking.date || bookingState.selectedDate;
      bookingState.specificService = result.booking.service || bookingState.specificService;
      const revisedDate = new Date(result.booking.date + 'T12:00:00');
      if (!Number.isNaN(revisedDate.getTime())) {
        bookingState.selectedYear = revisedDate.getFullYear();
        bookingState.selectedMonth = revisedDate.getMonth();
        bookingState.selectedDayNum = revisedDate.getDate();
      }
      populateReviewSummary();
      bookingState.emailDeferred = Boolean(result.booking.confirmationDeferred);
      bookingState.emailSent = Boolean(result.booking.emailSent);
      bookingState.emailError = result.booking.emailError || '';
      setEmailStatusNote(bookingState.confirmedEmail, bookingState.emailSent, bookingState.emailError, bookingState.emailDeferred);
      persistConfirmedBooking();
    }
  } finally { statusRefreshActive = false; }
}, 5000);
