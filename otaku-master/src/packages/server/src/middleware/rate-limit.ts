import rateLimit from 'express-rate-limit';
import { logger } from '@elizaos/core';
import { validateChannelId } from '../api/shared/validation';

/**
 * Rate limiting for authentication endpoints
 * Prevents credential stuffing and brute force attacks while allowing
 * legitimate users to retry on transient errors (DB connection issues, etc.)
 */
export const createAuthRateLimit = () => {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 attempts per minute (allows for retries on errors)
    message: {
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts. Please try again in a few minutes.',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts
    handler: (req, res) => {
      const clientIp = req.ip || 'unknown';
      logger.warn(`[SECURITY] Auth rate limit exceeded for IP: ${clientIp}`);
      res.status(429).json({
        success: false,
        error: {
          code: 'AUTH_RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts. Please try again in a few minutes.',
        },
      });
    },
  });
};

/**
 * General API rate limiting middleware
 * With trust proxy set to 1, express-rate-limit automatically handles X-Forwarded-For headers
 */
export const createApiRateLimit = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    },
    standardHeaders: true, // Return rate limit info in the `RateLimitInfo` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    // No custom keyGenerator needed - express-rate-limit handles IP detection automatically
    // when trust proxy is set (which we set to 1 in index.ts)
    handler: (req, res) => {
      const clientIp = req.ip || 'unknown';
      logger.warn(`[SECURITY] Rate limit exceeded for IP: ${clientIp}`);
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
      });
    },
  });
};

/**
 * Strict rate limiting for file system operations
 */
export const createFileSystemRateLimit = () => {
  return rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // Limit each IP to 100 file operations per 5 minutes
    message: {
      success: false,
      error: {
        code: 'FILE_RATE_LIMIT_EXCEEDED',
        message: 'Too many file operations. Please try again later.',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const clientIp = req.ip || 'unknown';
      logger.warn(
        `[SECURITY] File system rate limit exceeded for IP: ${clientIp}, endpoint: ${req.path}`
      );
      res.status(429).json({
        success: false,
        error: {
          code: 'FILE_RATE_LIMIT_EXCEEDED',
          message: 'Too many file operations. Please try again later.',
        },
      });
    },
  });
};

/**
 * Very strict rate limiting for upload operations
 */
export const createUploadRateLimit = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 uploads per 15 minutes
    message: {
      success: false,
      error: {
        code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
        message: 'Too many upload attempts. Please try again later.',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const clientIp = req.ip || 'unknown';
      logger.warn(
        `[SECURITY] Upload rate limit exceeded for IP: ${clientIp}, endpoint: ${req.path}`
      );
      res.status(429).json({
        success: false,
        error: {
          code: 'UPLOAD_RATE_LIMIT_EXCEEDED',
          message: 'Too many upload attempts. Please try again later.',
        },
      });
    },
  });
};

/**
 * Rate limiting specifically for channel validation attempts
 * Prevents brute force attacks on channel IDs
 */
export const createChannelValidationRateLimit = () => {
  return rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 200, // Limit each IP to 200 channel validation attempts per 10 minutes
    message: {
      success: false,
      error: {
        code: 'CHANNEL_VALIDATION_RATE_LIMIT_EXCEEDED',
        message: 'Too many channel validation attempts. Please try again later.',
      },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting if channel ID is valid (successful validations)
      const channelId = req.params.channelId;
      if (channelId) {
        const validatedChannelId = validateChannelId(channelId);
        return !!validatedChannelId; // Skip if valid
      }
      return false; // Apply rate limiting for invalid attempts
    },
    handler: (req, res) => {
      const clientIp = req.ip || 'unknown';
      const channelId = req.params.channelId || 'unknown';
      logger.warn(
        `[SECURITY] Channel validation rate limit exceeded for IP: ${clientIp}, attempted channel: ${channelId}`
      );
      res.status(429).json({
        success: false,
        error: {
          code: 'CHANNEL_VALIDATION_RATE_LIMIT_EXCEEDED',
          message: 'Too many channel validation attempts. Please try again later.',
        },
      });
    },
  });
};

