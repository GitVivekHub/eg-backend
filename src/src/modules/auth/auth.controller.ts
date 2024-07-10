import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Req,
	Res,
	UseGuards,
	UseInterceptors,
	UsePipes,
	ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryInterceptor } from 'src/common/interceptors/sentry.interceptor';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AadhaarVerified } from './dto/aadhaar-verify.dto';
import { GetMobileByUsernameSendOtpDTO } from './dto/get-mobile-by-username-send-otp.dto';
import { OtpSendDTO } from './dto/otp-send.dto';
import { OtpVerifyDTO } from './dto/otp-verify.dto';
import { RegisterDTO } from './dto/register.dto';
import { ResetPasswordAdminDTO } from './dto/reset-password-admin.dto';
import { UserExistDTO } from './dto/user-exist.dto';
import { UserOtpSendDTO } from './dto/username-otp.dto';

@UseInterceptors(SentryInterceptor)
@Controller('auth')
export class AuthController {
	constructor(public authService: AuthService) {}

	@Post('/otp-send')
	@UsePipes(ValidationPipe)
	public sendOtp(@Body() req: OtpSendDTO, @Res() response: Response) {
		return this.authService.sendOtp(req, response);
	}

	@Post('/otp-verify')
	@UsePipes(ValidationPipe)
	public verifyOtp(@Body() req: OtpVerifyDTO, @Res() response: Response) {
		return this.authService.verifyOtp(req, response);
	}

	@Post('/get-mobile-by-username-send-otp')
	@UsePipes(ValidationPipe)
	public getMobileByUsernameSendOtp(
		@Body() req: UserOtpSendDTO,
		@Res() response: Response,
	) {
		return this.authService.getMobileByUsernameSendOtp(req, response);
	}

	@Post('/forgot-password-otp')
	@UsePipes(ValidationPipe)
	public resetPasswordUsingOtp(
		@Body() req: GetMobileByUsernameSendOtpDTO,
		@Res() response: Response,
	) {
		return this.authService.resetPasswordUsingOtp(req, response);
	}

	@Post('/reset-password-admin')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	public resetPasswordUsingId(
		@Body() req: ResetPasswordAdminDTO,
		@Req() header: Request,
		@Res() response: Response,
	) {
		return this.authService.resetPasswordUsingId(req, header, response);
	}

	@Post('/reset-password-volunteer-admin')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	public resetPasswordUsingIdVolunteer(
		@Body() req: ResetPasswordAdminDTO,
		@Req() header: Request,
		@Res() response: Response,
	) {
		return this.authService.resetPasswordUsingIdVolunteer(
			req,
			header,
			response,
		);
	}

	@Post('/login')
	@UsePipes(ValidationPipe)
	login(@Req() req: Request, @Res() response: Response) {
		return this.authService.login(req, response);
	}

	// users/is_user_exist by mobile and adhaar etc filter.
	@Post('/is_user_exist')
	public async isUserExist(
		@Body() body: UserExistDTO,
		@Req() req: Request,
		@Res() response: Response,
	) {
		return this.authService.isUserExist(body, req, response);
	}

	// users/register on keycloak and hasura both side.
	@Post('/register')
	@UsePipes(ValidationPipe)
	public async register(
		@Body() body: RegisterDTO,
		@Res() response: Response,
	) {
		return this.authService.register(body, response);
	}

	@Post('/okyc/')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	private async createOkycRequest(
		@Body() body,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.createOkycRequest(body, request, response);
	}

	@Get('/okyc/:requestId/initiate/')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	private async initiateOkycRequest(
		@Param('requestId') id: string,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.initiateOkycRequest(id, request, response);
	}

	@Post('/okyc/:requestId/verify/')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	private async verifyOkycRequest(
		@Param('requestId') id: string,
		@Body() body,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.verifyOkycRequest(id, body, request, response);
	}

	@Post('/okyc/:requestId/complete/')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	private async completeOkycRequest(
		@Param('requestId') id: string,
		@Body() body,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.completeOkycRequest(
			id,
			body,
			request,
			response,
		);
	}

	@Get('/okyc/:requestId/:shareCode/')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	private async getOkycStatusRequest(
		@Param('requestId') id: string,
		@Param('shareCode') shareCode: number,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.getOkycStatusRequest(
			id,
			shareCode,
			request,
			response,
		);
	}

	@Patch('/aadhaar-kyc/:id')
	@UseGuards(new AuthGuard())
	@UsePipes(ValidationPipe)
	public async verifyAadhaarKyc(
		@Param('id') id: string,
		@Body() req: AadhaarVerified,
		@Res() response: any,
	) {
		return this.authService.verifyAadhaarKyc({ ...req, id: id }, response);
	}

	@Post('/okyc2/aadhaar/verify')
	@UseGuards(new AuthGuard())
	private async okyc2AadhaarVerify(
		@Body() body: any,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.okyc2AadhaarVerify(body, request, response);
	}

	@Get('/okyc2/aadhaar/verify/:id')
	@UseGuards(new AuthGuard())
	private async getOkyc2AadhaarVerificationStatus(
		@Param('id') id: string,
		@Req() request: any,
		@Res() response: Response,
	) {
		return this.authService.getOkyc2AadhaarVerificationStatus(
			id,
			request,
			response,
		);
	}
}
