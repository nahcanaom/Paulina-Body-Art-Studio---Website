'use strict';

/**
 * Sends one real booking-confirmation test message without creating a booking.
 *
 *   npm run email:test -- customer@example.com
 *
 * The recipient defaults to SMTP_USER (or the studio support address when
 * Resend is selected), which is useful for checking credentials safely.
 */

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });

const { getEmailConfig, sendBookingConfirmation } = require('../services/emailService');

function printConfiguration(config) {
  console.log('Email configuration');
  console.log(`  provider:          ${config.provider} (EMAIL_PROVIDER=${config.providerPreference})`);
  console.log(`  configured:        ${config.configured ? 'yes' : 'NO'}`);
  console.log(`  from:              ${config.fromName} <${config.fromEmail}>`);
  console.log(`  reply-to:          ${config.supportEmail}`);
  console.log(`  external delivery: ${config.externalDelivery ? 'enabled' : 'BLOCKED'}`);
  if (config.provider === 'smtp') {
    console.log(`  SMTP:              ${config.smtp.host}:${config.smtp.port} secure=${config.smtp.secure}`);
    console.log(`  password format:   ${config.smtp.passwordFormatValid ? 'valid' : 'INVALID'}`);
  }
  for (const warning of config.senderWarnings || []) {
    console.warn(`  warning:           ${warning}`);
  }
  console.log('');
}

async function main() {
  const config = getEmailConfig();
  printConfiguration(config);

  const recipient = String(
    process.argv[2] || (config.provider === 'smtp' ? config.smtp.user : '') || config.supportEmail || ''
  ).trim();

  if (!recipient) {
    console.error('No test recipient was provided and no default sender is configured.');
    process.exitCode = 1;
    return;
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  console.log(`Sending a test confirmation to ${recipient}...`);

  const result = await sendBookingConfirmation({
    reference: 'PLN-EMAILTEST',
    fullName: 'Email Delivery Test',
    email: recipient,
    phone: '000 000 0000',
    serviceType: 'Tattoo',
    service: 'Custom Tattoo',
    artist: 'Paulina Vampire',
    date: tomorrow.toISOString().slice(0, 10),
    time: '12:30 PM',
    paymentMethod: 'GCash',
    notes: 'This is an automated delivery test. No appointment has been booked.'
  });

  console.log('');
  console.log('Delivery succeeded.');
  console.log(`  provider: ${result.provider}`);
  console.log(`  message:  ${result.id || '(no provider id returned)'}`);
  console.log(`  to:       ${result.recipient}`);
  console.log(`  template: ${result.templateVersion}`);
}

main().catch((error) => {
  console.error('');
  console.error('Delivery failed.');
  console.error(`  code:     ${error.code || 'EMAIL_SEND_FAILED'}`);
  console.error(`  message:  ${error.message}`);
  if (error.response) console.error(`  response: ${error.response}`);
  process.exitCode = 1;
});
