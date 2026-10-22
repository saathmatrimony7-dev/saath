import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { normalisePhoneE164 } from '../../common/phone';
import type { AppConfig } from '../../config';
import { AuthService } from './auth.service';
import { APP_CONFIG } from './tokens';
import { OtpError } from './otp.service';
import {
  otpRequestSchema,
  otpVerifySchema,
  type OtpRequestDto,
  type OtpVerifyDto,
} from './auth.dto';
import { clearAuthCookies, CsrfGuard, REFRESH_COOKIE, setAuthCookies } from './guards';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private normalisePhone(raw: string): string {
    try {
      return normalisePhoneE164(raw);
    } catch {
      throw new BadRequestException('invalid phone number');
    }
  }

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestOtp(
    @Body(new ZodValidationPipe(otpRequestSchema)) body: OtpRequestDto,
    @Ip() ip: string,
  ): Promise<{ status: string }> {
    try {
      const phone = this.normalisePhone(body.phone);
      await this.auth.requestOtp(phone, await this.auth.hashIp(ip));
      return { status: 'sent' };
    } catch (err) {
      if (err instanceof OtpError && err.code === 'RATE_LIMITED') {
        throw new HttpException('too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
      throw err;
    }
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body(new ZodValidationPipe(otpVerifySchema)) body: OtpVerifyDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; csrfToken: string }> {
    try {
      const phone = this.normalisePhone(body.phone);
      const tokens = await this.auth.verifyOtpAndLogin(
        phone,
        body.code,
        await this.auth.hashIp(ip),
        req.headers['user-agent'],
      );
      const csrfToken = setAuthCookies(res, this.config, tokens.accessToken, tokens.refreshToken);
      return { userId: tokens.userId, csrfToken };
    } catch (err) {
      if (err instanceof OtpError) {
        const status =
          err.code === 'RATE_LIMITED' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.UNAUTHORIZED;
        throw new HttpException(err.message, status);
      }
      throw err;
    }
  }

  @Post('refresh')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; csrfToken: string }> {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!presented) throw new UnauthorizedException('missing refresh token');
    const tokens = await this.auth.refresh(presented);
    const csrfToken = setAuthCookies(res, this.config, tokens.accessToken, tokens.refreshToken);
    return { userId: tokens.userId, csrfToken };
  }

  @Post('logout')
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (presented) await this.auth.logout(presented);
    clearAuthCookies(res, this.config);
  }
}
