import { BaseApiClient } from "../lib/base-client";
import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenResponse,
  CurrentUserResponse,
} from "../types/auth";

/**
 * Service for JWT authentication endpoints
 */
export class AuthService extends BaseApiClient {
  /**
   * Login with email and get JWT token
   *
   * @param request Login credentials
   * @returns JWT token and user ID
   */
  async login(request: LoginRequest): Promise<LoginResponse> {
    const response = await this.post<LoginResponse>("/api/auth/login", request);
    return response;
  }

  /**
   * Refresh authentication token
   * Extends token expiration without requiring re-authentication
   *
   * @returns New JWT token with extended expiration
   */
  async refreshToken(): Promise<RefreshTokenResponse> {
    const response = await this.post<RefreshTokenResponse>(
      "/api/auth/refresh",
      {},
    );
    return response;
  }

  /**
   * Get current authenticated user info
   * Useful for validating tokens and getting user details
   *
   * @returns Current user information
   */
  async getCurrentUser(): Promise<CurrentUserResponse> {
    const response = await this.get<CurrentUserResponse>("/api/auth/me");
    return response;
  }

  /**
   * Logout and revoke the current token
   * The token will no longer be valid for refresh
   *
   * @returns Success message
   */
  async logout(): Promise<{ message: string }> {
    const response = await this.post<{ message: string }>(
      "/api/auth/logout",
      {},
    );
    return response;
  }
}
