const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  host: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  campaign: {
    type: String,
    required: true,
    trim: true
  },
  always: {
    type: Boolean,
    default: false
  },
  cartExtra: {
    type: Boolean,
    default: true
  },
  script: {
    type: String,
    default: null
  },
  scriptUrl: {
    type: String,
    default: null
  },
  api: {
    type: String,
    default: null
  },
  pixel: {
    type: String,
    default: null
  },
  checkString: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Site', siteSchema);
