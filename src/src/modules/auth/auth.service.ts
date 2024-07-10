import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt_decode from 'jwt-decode';
import { UserHelperService } from 'src/helper/userHelper.service';
import { AadhaarKycService } from 'src/modules/aadhaar_kyc/aadhaar_kyc.service';
import { HasuraService } from 'src/services/hasura/hasura.service';
import { KeycloakService } from 'src/services/keycloak/keycloak.service';
import { UserService } from 'src/user/user.service';
import * as moment from 'moment';
const crypto = require('crypto');
const axios = require('axios');
const atob = require('atob');
const jwt = require('jwt-decode');
@Injectable()
export class AuthService {
	public smsKey = this.configService.get<string>('SMS_KEY');
	public keycloak_admin_cli_client_secret = this.configService.get<string>(
		'KEYCLOAK_ADMIN_CLI_CLIENT_SECRET',
	);

	constructor(
		private configService: ConfigService,
		private aadhaarKycService: AadhaarKycService,
		private readonly keycloakService: KeycloakService,
		private readonly hasuraService: HasuraService,
		private readonly userHelperService: UserHelperService,
		private userService: UserService,
	) {}

	public returnFields = [
		'aadhar_token',
		'aadhar_verified',
		'aadhar_no',
		'aadhaar_verification_mode',
	];
	public async sendOtp(req, response) {
		const mobile = req.mobile;
		const reason = req.reason;

		if (mobile && reason) {
			const sendOtpRes = await this.generateAndSendOtp(mobile, reason);
			console.log('sendOtpRes', sendOtpRes);

			if (sendOtpRes.success) {
				return response.status(200).json(sendOtpRes);
			} else {
				return response.status(400).json(sendOtpRes);
			}
		}
	}

	public async verifyOtp(req, response) {
		const mobile = req.mobile;
		const hash = req.hash;
		const otp = req.otp;
		const reason = req.reason;

		const otpVerify = await this.otpVerification(mobile, hash, otp, reason);

		if (otpVerify === 'Timeout please try again') {
			return response.status(400).json({
				success: false,
				message: 'Timeout please try again',
				data: {},
			});
		}

		if (otpVerify === 'OTP verified successfully') {
			return response.status(200).json({
				success: true,
				message: 'OTP verified successfully!',
				data: {},
			});
		}

		if (otpVerify === 'Incorrect OTP') {
			return response.status(400).json({
				success: false,
				message: 'Incorrect OTP',
				data: {},
			});
		}
	}

	public async verifyAadhaarKyc(req: any, response: any) {
		const tableName = 'users';
		const result = await this.hasuraService.update(
			req.id,
			tableName,
			req,
			this.returnFields,
			[...this.returnFields, 'id'],
		);
		if (result.users) {
			return response.status(200).send({
				success: true,
				message: 'User Updated successfully!',
				data: { user: result.users },
			});
		} else {
			return response.status(500).send({
				success: false,
				message: 'Unable to Update User!',
				data: {},
			});
		}
	}

	public async getUserByUsername(req) {
		const username = req.username;
		const { user, isUserExist } =
			await this.keycloakService.getUserByUsername(req.username);

		if (isUserExist === false) {
			return { isUserExist: false, user: null };
		}

		//find mobile no.
		let query = {
			query: `query MyQuery2 {
				users(where: {keycloak_id: {_eq: "${user?.id}"}}) {
				  keycloak_id
				  last_name
				  id
				  first_name
				  mobile
				}
			  }`,
		};
		const userRes = await this.hasuraService.postData(query);

		return userRes;
	}

	public async resetPasswordUsingOtp(req, response) {
		console.log('req', req);
		const hash = req.hash;
		const otp = req.otp;
		const reason = req.reason;
		const userRes = await this.getUserByUsername(req);

		if (userRes?.data?.users?.length > 0) {
			const mobile = userRes?.data?.users[0]?.mobile;
			const keycloak_id = userRes?.data?.users[0]?.keycloak_id;

			console.log('mobile', mobile);
			console.log('keycloak_id', keycloak_id);

			if (mobile && keycloak_id) {
				const otpVerify = await this.otpVerification(
					mobile,
					hash,
					otp,
					reason,
				);

				if (otpVerify === 'Timeout please try again') {
					return response.status(400).json({
						success: false,
						message: 'Timeout please try again',
						data: {},
					});
				}

				if (otpVerify === 'OTP verified successfully') {
					const token =
						await this.keycloakService.getAdminKeycloakToken();

					if (token?.access_token && keycloak_id) {
						const resetPasswordRes =
							await this.keycloakService.resetPassword(
								keycloak_id,
								token.access_token,
								req.password,
							);

						if (resetPasswordRes) {
							return response.status(200).json({
								success: true,
								message: 'Password updated successfully!',
								data: {},
							});
						} else {
							return response.status(200).json({
								success: false,
								message: 'unable to reset password!',
								data: {},
							});
						}
					} else {
						return response.status(200).json({
							success: false,
							message: 'unable to get token',
							data: {},
						});
					}
				}

				if (otpVerify === 'Incorrect OTP') {
					return response.status(400).json({
						success: false,
						message: 'Incorrect OTP',
						data: {},
					});
				}
			} else {
				return response.status(400).json({
					success: false,
					message: 'Mobile no. not found!',
					data: {},
				});
			}
		} else {
			return response.status(400).json({
				success: false,
				message: 'Username not found!',
				data: {},
			});
		}
	}

	public async getMobileByUsernameSendOtp(req, response) {
		const reason = req.reason;

		const userRes = await this.getUserByUsername(req);

		if (userRes.isUserExist !== false && userRes?.data?.users?.length > 0) {
			const mobile = userRes?.data?.users[0]?.mobile;

			if (mobile) {
				const sendOtpRes = await this.generateAndSendOtp(
					mobile,
					reason,
				);
				console.log('sendOtpRes', sendOtpRes);

				if (sendOtpRes.success) {
					return response.status(200).json(sendOtpRes);
				} else {
					return response.status(400).json(sendOtpRes);
				}
			} else {
				return response.status(400).json({
					success: false,
					message: 'Mobile no. not found!',
					data: {},
				});
			}
		} else {
			return response.status(400).json({
				success: false,
				message: 'Username not found!',
				data: {},
			});
		}
	}

	public async resetPasswordUsingId(req, header, response) {
		const { mw_roles } = header;
		const authToken = header.header('authorization');
		const decoded: any = jwt_decode(authToken);
		let keycloak_id = decoded.sub;

		let query2 = {
			query: `query MyQuery {
				users(where: {keycloak_id: {_eq: "${keycloak_id}" }}) {
				  id
				  keycloak_id
				  program_users {
					roles {
					  id
					  role_type
					  slag
					}
				  }
				}
			  }`,
		};

		const userRole = await this.hasuraService.postData(query2);
		if (mw_roles.includes('staff')) {
			let query = {
				query: `query MyQuery {
					users_by_pk(id: ${req.id}) {
					  keycloak_id
					  last_name
					  id
					  first_name
					}
				  }`,
			};

			const userRes = await this.hasuraService.postData(query);

			if (userRes) {
				const token =
					await this.keycloakService.getAdminKeycloakToken();
				if (
					token?.access_token &&
					userRes.data.users_by_pk.keycloak_id
				) {
					const resetPasswordRes =
						await this.keycloakService.resetPassword(
							userRes.data.users_by_pk.keycloak_id,
							token.access_token,
							req.password,
						);

					if (resetPasswordRes) {
						return response.status(200).json({
							success: true,
							message: 'Password updated successfully!',
							data: {},
						});
					} else {
						return response.status(200).json({
							success: false,
							message: 'unable to reset password!',
							data: {},
						});
					}
				} else {
					return response.status(200).json({
						success: false,
						message: 'unable to get token',
						data: {},
					});
				}
			} else {
				return response.status(200).json({
					success: false,
					message: 'User not found!',
					data: {},
				});
			}
		} else {
			return response.status(200).json({
				success: false,
				message: "User cann't reset password",
				data: {},
			});
		}
	}

	public async resetPasswordUsingIdVolunteer(req, header, response) {
		const { mw_roles } = header;
		const authToken = header.header('authorization');
		const decoded: any = jwt_decode(authToken);
		let keycloak_id = decoded.sub;

		let query2 = {
			query: `query MyQuery {
				users(where: {keycloak_id: {_eq: "${keycloak_id}" }}) {
				  id
				  keycloak_id
				  program_users {
					roles {
					  id
					  role_type
					  slag
					}
				  }
				}
			  }`,
		};

		const userRole = await this.hasuraService.postData(query2);
		if (mw_roles.includes('volunteer_admin')) {
			let query = {
				query: `query MyQuery {
					users_by_pk(id: ${req.id}) {
					  keycloak_id
					  last_name
					  id
					  first_name
					}
				  }`,
			};

			const userRes = await this.hasuraService.postData(query);

			if (userRes) {
				const token =
					await this.keycloakService.getAdminKeycloakToken();
				if (
					token?.access_token &&
					userRes.data.users_by_pk.keycloak_id
				) {
					const resetPasswordRes =
						await this.keycloakService.resetPassword(
							userRes.data.users_by_pk.keycloak_id,
							token.access_token,
							req.password,
						);

					if (resetPasswordRes) {
						return response.status(200).json({
							success: true,
							message: 'Password updated successfully!',
							data: {},
						});
					} else {
						return response.status(200).json({
							success: false,
							message: 'unable to reset password!',
							data: {},
						});
					}
				} else {
					return response.status(200).json({
						success: false,
						message: 'unable to get token',
						data: {},
					});
				}
			} else {
				return response.status(200).json({
					success: false,
					message: 'User not found!',
					data: {},
				});
			}
		} else {
			return response.status(200).json({
				success: false,
				message: "User cann't reset password",
				data: {},
			});
		}
	}

	public async login(req, response) {
		const data = {
			username: req.body.username,
			password: req.body.password,
		};

		const token = await this.keycloakService.getUserKeycloakToken(data);
		if (token) {
			await this.updateLastLogin(token);
			return response.status(200).send({
				success: true,
				message: 'LOGGEDIN_SUCCESSFULLY',
				data: token,
			});
		} else {
			return response.status(401).send({
				success: false,
				message: 'INVALID_USERNAME_PASSWORD_MESSAGE',
				data: null,
			});
		}
	}

	public async isUserExist(body, req, response) {
		// Set User table name
		const tableName = 'users';

		// Calling hasura common method find all
		const data_exist = await this.hasuraService.findAll(tableName, body);
		let userExist = data_exist.data.users;
		let tokenUserId = req.mw_userid;

		// Check wheather user is exist or not based on response
		if (userExist.length > 0) {
			const underSameFacilitatorCond = userExist.some((user) =>
				user?.program_beneficiaries.some(
					(item) => item?.facilitator_id == tokenUserId,
				),
			);

			const registeredAsFacilitator = userExist.some((user) =>
				user?.program_faciltators?.some((item) => item?.id),
			);

			const registeredAsBeneficiaries = userExist.some((user) =>
				user?.program_beneficiaries?.some(
					(item) => item?.facilitator_id,
				),
			);
			return response.status(200).send({
				success: true,
				message: 'User exist',
				data: {},
				userExist,
				underSameFacilitator: underSameFacilitatorCond || false,
				registeredAsFacilitator: registeredAsFacilitator || false,
				registeredAsBeneficiaries: registeredAsBeneficiaries || false,
			});
		} else {
			return response.status(200).send({
				success: false,
				message: 'User not exist',
				data: {},
			});
		}
	}
	public async createOkycRequest(body, request, response) {
		return await this.aadhaarKycService.createOkycRequest(
			body,
			request,
			response,
		);
	}

	public async initiateOkycRequest(id, request, response) {
		return await this.aadhaarKycService.initiateOkycRequest(
			id,
			request,
			response,
		);
	}
	public async verifyOkycRequest(id, body, request, response) {
		return await this.aadhaarKycService.verifyOkycRequest(
			id,
			body,
			request,
			response,
		);
	}
	public async completeOkycRequest(id, body, request, response) {
		return await this.aadhaarKycService.completeOkycRequest(
			id,
			body,
			request,
			response,
		);
	}

	public async getOkycStatusRequest(id, shareCode, request, response) {
		return await this.aadhaarKycService.getOkycStatusRequest(
			id,
			shareCode,
			request,
			response,
		);
	}
	public async okyc2AadhaarVerify(body, request, response) {
		return await this.aadhaarKycService.okyc2AadhaarVerify(
			body,
			request,
			response,
		);
	}

	public async getOkyc2AadhaarVerificationStatus(id, request, response) {
		return await this.aadhaarKycService.getOkyc2AadhaarVerificationStatus(
			id,
			request,
			response,
		);
	}

	public async register(body, response) {
		let misssingFieldsFlag = false;
		if (body.role === 'facilitator') {
			let isMobileExist = await this.hasuraService.findAll('users', {
				mobile: body?.mobile,
			});
			let userExist = isMobileExist?.data?.users;

			if (userExist.length > 0) {
				return response.status(422).send({
					success: false,
					message: 'Mobile Number Already Exist',
					data: {},
				});
			}

			// Validate role specific fields
			if (
				!body.role_fields.parent_ip ||
				!body.role_fields.program_id ||
				!body.role_fields.academic_year_id
			) {
				misssingFieldsFlag = true;
			}
		} else if (body.role === 'beneficiary') {
			// Validate role specific fields
			if (
				!body.role_fields.facilitator_id ||
				!body.role_fields.program_id ||
				!body.role_fields.academic_year_id
			) {
				misssingFieldsFlag = true;
			}
		} else if (body.role === 'staff') {
			if (
				!body.role_fields.organisation_id ||
				!body.role_fields.program_id ||
				!body.role_fields.academic_year_id ||
				!body.role_fields.role_slug
			) {
				misssingFieldsFlag = true;
			}
		} else {
			misssingFieldsFlag = true;
		}
		if (misssingFieldsFlag) {
			throw new BadRequestException({
				success: false,
				message: 'Invalid parameters',
			});
		}

		// Generate random password
		const password = `@${this.userHelperService.generateRandomPassword()}`;

		// Generate username
		let username = `${body.first_name}`;
		if (body?.last_name) {
			username += `_${body.last_name.charAt(0)}`;
		}
		username += `_${body.mobile}`;
		username = username.toLowerCase();

		// Role to group mapping
		let group = body.role;

		switch (body.role) {
			case 'facilitator': {
				group = `facilitators`;
				break;
			}

			case 'beneficiary': {
				group = `beneficiaries`;
				break;
			}
			case 'staff': {
				group = `staff`;
				break;
			}
		}

		let data_to_create_user = {
			enabled: 'true',
			firstName: body?.first_name,
			lastName: body?.last_name,
			username: username,
			credentials: [
				{
					type: 'password',
					value: password,
					temporary: false,
				},
			],
			groups: [`${group}`],
		};

		console.log('data_to_create_user', data_to_create_user);

		const token = await this.keycloakService.getAdminKeycloakToken();

		if (token?.access_token) {
			const findUsername = await this.keycloakService.findUser(
				username,
				token?.access_token,
			);
			console.log('findUsername', findUsername);

			if (findUsername.length > 0 && group === 'beneficiaries') {
				let lastUsername =
					findUsername[findUsername.length - 1].username;
				console.log('lastUsername', lastUsername);
				let count = findUsername.length;
				console.log('count', count);
				data_to_create_user.username =
					data_to_create_user.username + '_' + count;
			}
			console.log('data_to_create_user 407', data_to_create_user);

			const registerUserRes = await this.keycloakService.registerUser(
				data_to_create_user,
				token.access_token,
			);
			console.log('registerUserRes', registerUserRes);
			if (registerUserRes.error) {
				if (
					registerUserRes.error.message ==
					'Request failed with status code 409'
				) {
					return response.status(200).json({
						success: false,
						message: 'User already exists!',
						data: {},
					});
				} else {
					return response.status(200).json({
						success: false,
						message: registerUserRes.error.message,
						data: {},
					});
				}
			} else if (registerUserRes.headers.location) {
				const split = registerUserRes.headers.location.split('/');
				const keycloak_id = split[split.length - 1];
				body.keycloak_id = keycloak_id;
				body.username = data_to_create_user.username;
				body.password = password;
				if (body.role_fields.parent_ip) {
					body.parent_ip = body.role_fields.parent_ip;
				}
				if (body.role_fields.program_id) {
					body.program_id = body.role_fields.program_id;
				}
				if (body.role_fields.academic_year_id) {
					body.academic_year_id = body.role_fields.academic_year_id;
				}
				if (body.role_fields.facilitator_id) {
					body.facilitator_id = body.role_fields.facilitator_id;
				}
				if (body.role_fields.organisation_id) {
					body.organisation_id = body.role_fields.organisation_id;
				}
				if (body.role_fields.role_slug) {
					body.role_slug = body.role_fields.role_slug;
				}
				if (body.role === 'facilitator' && body.hasOwnProperty('dob')) {
					delete body.dob;
				}
				console.log('body 415', body);
				const result = await this.newCreate(body);
				console.log('result', result);
				if (
					body.role === 'beneficiary' &&
					result.data.program_beneficiaries
				) {
					await this.userService.addAuditLog(
						result?.data?.id,
						body.role_fields.facilitator_id,
						'program_beneficiaries.status',
						result?.data?.program_beneficiaries[0]?.id,
						{
							status: '',
							reason_for_status_update: '',
						},
						{
							status: result?.data?.program_beneficiaries[0]
								?.status,
							reason_for_status_update: 'new registration',
						},
						['status', 'reason_for_status_update'],
					);
				}
				if (body.role === 'staff' && result.data.program_users) {
				}
				// Send login details SMS
				// नमस्कार, प्रगति प्लेटफॉर्म पर आपका अकाउंट बनाया गया है। आपका उपयोगकर्ता नाम <arg1> है और पासवर्ड <arg2> है। FEGG
				if (body.role === 'facilitator') {
					const message = `%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%95%E0%A4%BE%E0%A4%B0,%20%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%97%E0%A4%A4%E0%A4%BF%20%E0%A4%AA%E0%A5%8D%E0%A4%B2%E0%A5%87%E0%A4%9F%E0%A4%AB%E0%A5%89%E0%A4%B0%E0%A5%8D%E0%A4%AE%20%E0%A4%AA%E0%A4%B0%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%85%E0%A4%95%E0%A4%BE%E0%A4%89%E0%A4%82%E0%A4%9F%20%E0%A4%AC%E0%A4%A8%E0%A4%BE%E0%A4%AF%E0%A4%BE%20%E0%A4%97%E0%A4%AF%E0%A4%BE%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%89%E0%A4%AA%E0%A4%AF%E0%A5%8B%E0%A4%97%E0%A4%95%E0%A4%B0%E0%A5%8D%E0%A4%A4%E0%A4%BE%20%E0%A4%A8%E0%A4%BE%E0%A4%AE%20%3Carg1%3E%20%E0%A4%B9%E0%A5%88%20%E0%A4%94%E0%A4%B0%20%E0%A4%AA%E0%A4%BE%E0%A4%B8%E0%A4%B5%E0%A4%B0%E0%A5%8D%E0%A4%A1%20%3Carg2%3E%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20FEGG`;
					const args = `arg1:${body.username},arg2:${body.password}`;
					const otpRes = await this.sendSMS(
						body.mobile,
						message,
						args,
					);
					console.log('otpRes', otpRes);
				}

				return response.status(200).send({
					success: true,
					message: 'User created successfully',
					data: {
						user: result?.data,
						keycloak_id: keycloak_id,
						username: data_to_create_user.username,
						password: password,
					},
				});
			} else {
				return response.status(200).json({
					success: false,
					message: 'Unable to create user in keycloak',
					data: {},
				});
			}
		} else {
			return response.status(200).json({
				success: false,
				message: 'Unable to get keycloak token',
				data: {},
			});
		}
	}

	public async generateAndSendOtp(mobile, reason) {
		const otp = crypto.randomInt(100000, 999999);
		const ttl = parseInt(process.env.OTP_EXPIRY_IN_MINUTES) * 60 * 1000;
		const expires = Date.now() + ttl;
		const data = `${mobile}.${otp}.${reason}.${expires}`;
		const smsKey = this.smsKey;

		const hash = crypto
			.createHmac('sha256', smsKey)
			.update(data)
			.digest('hex');
		const fullhash = `${hash}.${expires}`;

		console.log('OTP_EXPIRY_IN_MINUTES', process.env.OTP_EXPIRY_IN_MINUTES);
		console.log('mobile', mobile);
		console.log('reason', reason);
		console.log('fullhash', fullhash);
		console.log('otp', otp);

		const mobileStr = mobile.toString();

		if (otp && fullhash) {
			// Send OTP SMS
			// नमस्ते, प्रगति प्लेटफॉर्म पर सत्यापन/लॉगिन के लिए आपका ओटीपी <arg1> है। FEGG
			const message = `%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87,%20%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%97%E0%A4%A4%E0%A4%BF%20%E0%A4%AA%E0%A5%8D%E0%A4%B2%E0%A5%87%E0%A4%9F%E0%A4%AB%E0%A5%89%E0%A4%B0%E0%A5%8D%E0%A4%AE%20%E0%A4%AA%E0%A4%B0%20%E0%A4%B8%E0%A4%A4%E0%A5%8D%E0%A4%AF%E0%A4%BE%E0%A4%AA%E0%A4%A8/%E0%A4%B2%E0%A5%89%E0%A4%97%E0%A4%BF%E0%A4%A8%20%E0%A4%95%E0%A5%87%20%E0%A4%B2%E0%A4%BF%E0%A4%8F%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%93%E0%A4%9F%E0%A5%80%E0%A4%AA%E0%A5%80%20%3Carg1%3E%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20FEGG`;
			const args = `arg1:${otp}`;
			const otpRes = await this.sendSMS(mobile, message, args);
			console.log('otpRes', otpRes);

			if (otpRes) {
				return {
					success: true,
					message: `Otp successfully sent to XXXXXX${mobileStr.substring(
						6,
					)}`,
					data: {
						hash: fullhash,
					},
				};
			} else {
				return {
					success: false,
					message: 'Unable to send OTP!',
					data: {},
				};
			}
		} else {
			return {
				success: false,
				message: 'Unable to send OTP!',
				data: {},
			};
		}
	}

	public async otpVerification(mobile, hash, otp, reason) {
		let [hashValue, expires] = hash.split('.');
		let now = Date.now();

		if (now > parseInt(expires)) {
			return 'Timeout please try again';
		}

		const data = `${mobile}.${otp}.${reason}.${expires}`;
		const smsKey = this.smsKey;

		const newCalculatedHash = crypto
			.createHmac('sha256', smsKey)
			.update(data)
			.digest('hex');

		if (newCalculatedHash === hashValue) {
			return 'OTP verified successfully';
		} else {
			return 'Incorrect OTP';
		}
	}

	public async sendSMS(mobileNo, message, args) {
		console.log('mobileNo', mobileNo);
		console.log('message', message);
		console.log('args', args);

		let config = {
			method: 'get',
			maxBodyLength: Infinity,
			url: `${process.env.SMS_GATEWAY_BASE_URL}/VoicenSMS/webresources/CreateSMSCampaignGet?ukey=${process.env.SMS_GATEWAY_API_KEY}&msisdnlist=phoneno:${mobileNo},${args}&language=2&credittype=7&senderid=FEGGPR&templateid=32490&message=${message}&isschd=false&isrefno=true&filetype=1`,
			headers: {},
		};

		try {
			const res = await axios.request(config);
			console.log('otp api res', res.data);
			return res.data;
		} catch (err) {
			console.log('otp err', err);
		}
	}

	async newCreate(req: any) {
		const tableName = 'users';
		let other = [];
		const newR = await this.hasuraService.q(
			tableName,
			{ ...req, aadhar_verified: 'pending' },
			[
				'first_name',
				'last_name',
				'middle_name',
				'mobile',
				'email_id',
				'dob',
				'gender',
				'keycloak_id',
				'username',
				'aadhar_verified',
				'village',
				'state',
				'block',
				'district',
				'grampanchayat',
				'alternative_mobile_number',
				'pincode',
				'lat',
				'long',
			],
		);

		const user_id = newR[tableName]?.id;

		let programRoleTableName = '';
		let groupId = '';

		if (req.role === 'beneficiary' || req.role === 'beneficiaries') {
			programRoleTableName = 'program_beneficiaries';
			groupId = 'facilitator_id';
			req.facilitator_id = req.role_fields.facilitator_id;
			req.program_id = req.role_fields.program_id;
			req.academic_year_id = req.role_fields.academic_year_id;
			req.status = 'identified';
			req.org_id = req?.role_fields?.org_id;
			(req.learning_motivation = JSON.stringify(
				req?.program_beneficiaries?.learning_motivation,
			).replace(/"/g, '\\"')),
				(req.type_of_support_needed = JSON.stringify(
					req?.program_beneficiaries?.type_of_support_needed,
				).replace(/"/g, '\\"'));
			req.learning_level = req?.program_beneficiaries?.learning_level;

			other = [
				...other,
				'org_id',
				'learning_motivation',
				'type_of_support_needed',
				'learning_level',
			];
		}

		if (req.role === 'facilitator' || req.role === 'facilitators') {
			programRoleTableName = 'program_faciltators';
			groupId = 'parent_ip';
			req.parent_ip = `${req.role_fields.parent_ip}`;
			req.program_id = req.role_fields.program_id;
			req.academic_year_id = req.role_fields.academic_year_id;
			req.status = 'applied';
		}
		if (req.role === 'staff') {
			programRoleTableName = 'program_users';
			groupId = 'organisation_id';
			req.organisation_id = `${req.role_fields.organisation_id}`;
			req.program_id = req.role_fields.program_id;
			req.academic_year_id = req.role_fields.academic_year_id;
			req.role_slug = req.role_fields.role_slug;
			other = [...other, 'role_slug'];
		}
		console.log('tableName', programRoleTableName);
		console.log('groupId', groupId);

		if (user_id) {
			await this.hasuraService.q(
				`${programRoleTableName}`,
				{
					...req,
					user_id,
					program_id: req.program_id,
					academic_year_id: req.academic_year_id,
				},
				[
					`${groupId}`,
					'user_id',
					'program_id',
					'academic_year_id',
					'status',
					...(other || []),
				],
			);
		}

		const result = await this.userById(user_id);
		return result;
	}

	async userById(id: any) {
		let data = {
			query: `query searchById {
			users_by_pk(id: ${id}) {
			  first_name
			  id
			  last_name
			  middle_name
			  dob
			  aadhar_token
			  address
			  block_id
			  block_village_id
			  created_by
			  district_id
			  email_id
			  gender
			  lat
			  long
			  mobile
			  state_id
			  updated_by
			  profile_url
			  state
			  district
			  block
			  village
			  grampanchayat
			  program_users {
				id
				organisation_id
				academic_year_id
				program_id
				role_id
				status
				user_id
			  }
			  core_faciltator {
				created_by
				device_ownership
				device_type
				id
				pan_no
				refreere
				sourcing_channel
				updated_by
				user_id
			  }
			  experience {
				description
				end_year
				experience_in_years
				institution
				start_year
				organization
				role_title
				user_id
				type
			  }
			  program_beneficiaries {
				beneficiaries_found_at
				created_by
				facilitator_id
				id
				status
				reason_for_status_update
				academic_year_id
				user_id
				exam_fee_document_id
				exam_fee_date
				syc_subjects
				is_continued
			  }
			  program_faciltators {
				parent_ip
				availability
				has_social_work_exp
				id
				police_verification_done
				program_id
				social_background_verified_by_neighbours
				user_id
				village_knowledge_test
				status
				form_step_number
				created_by
				updated_by
				academic_year_id
				program_id
			  }
			  qualifications {
				created_by
				end_year
				id
				institution
				qualification_master_id
				start_year
				updated_by
				user_id
				qualification_master {
				  context
				  context_id
				  created_by
				  id
				  name
				  type
				  updated_by
				}
			  }
			  interviews {
				id
				title
				user_id
				owner_user_id
				date
				start_time
				end_time
				interviewer_name
				status
				comment
				reminder
				rsvp
				location_type
				location
				created_at
				created_by
				updated_at
				updated_by
				owner {
				  first_name
				  last_name
				  id
				}
			  }
			  events {
				context
				context_id
				created_by
				end_date
				end_time
				id
				location
				location_type
				start_date
				start_time
				updated_by
				user_id
			  }
			  documents(order_by: {id: desc}){
				id
				user_id
				name
				doument_type
				document_sub_type
			  }
			}}`,
		};

		const response = await this.hasuraService.postData(data);

		let result = response?.data?.users_by_pk;
		if (result?.program_faciltators && result?.program_faciltators[0]) {
			result.program_faciltators = result.program_faciltators[0];
		} else {
			result = { ...result, program_faciltators: {} };
		}
		let mappedResponse = result;

		if (result?.experience) {
			mappedResponse = {
				...mappedResponse,
				['experience']: result?.experience.filter(
					(e: any) => e.type == 'experience',
				),
			};

			mappedResponse = {
				...mappedResponse,
				['vo_experience']: result?.experience.filter(
					(e: any) => e.type == 'vo_experience',
				),
			};
		}

		return {
			statusCode: 200,
			message: 'Ok.',
			data: mappedResponse,
		};
	}

	public async updateLastLogin(token) {
		try {
			const { access_token } = token;
			// Decode the token to extract user_id
			const decoded: any = jwt_decode(access_token);
			const userId = decoded?.sub; // Assuming 'sub' contains the user_id
			const currentDate = moment().format('YYYY-MM-DD HH:mm:ss');
			// Update the last_login timestamp in the database

			const updateLastLoginQuery = {
				query: `mutation UpdateLastLogin {
					update_users(where: {keycloak_id: {_eq: "${userId}"}}, _set: {last_login: "${currentDate}"}) {
						affected_rows
					}
				}`,
			};

			const result = await this.hasuraService.getData(
				updateLastLoginQuery,
			);
		} catch (error) {
			console.error('Failed to update last_login', error);
		}
	}
}
