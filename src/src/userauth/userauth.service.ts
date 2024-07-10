import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserHelperService } from 'src/helper/userHelper.service';
import { HasuraService } from 'src/services/hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';
import { KeycloakService } from 'src/services/keycloak/keycloak.service';
import { AuthService } from 'src/modules/auth/auth.service';
import { Method } from '../common/method/method';
import { AcknowledgementService } from 'src/modules/acknowledgement/acknowledgement.service';
import { UserService } from 'src/user/user.service';
import { S3Service } from 'src/services/s3/s3.service';
import { UploadFileService } from 'src/upload-file/upload-file.service';
const { Blob } = require('buffer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

//url to base64
import fetch from 'node-fetch';
import { Buffer } from 'buffer';

@Injectable()
export class UserauthService {
	public smsKey = this.configService.get<string>('SMS_KEY');
	public keycloak_admin_cli_client_secret = this.configService.get<string>(
		'KEYCLOAK_ADMIN_CLI_CLIENT_SECRET',
	);
	constructor(
		private configService: ConfigService,
		private readonly keycloakService: KeycloakService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
		private readonly hasuraService: HasuraService,
		private readonly userHelperService: UserHelperService,
		private authService: AuthService,
		private acknowledgementService: AcknowledgementService,
		private userService: UserService,
		private readonly s3Service: S3Service,
		private method: Method,
		private uploadFileService: UploadFileService,
	) {}

	public async userAuthRegister(body, response, role) {
		let validate_result = await this.validateFields(role, body);

		if (validate_result?.status == false) {
			return response.json({
				validate_result,
			});
		}

		let misssingFieldsFlag = false;
		if (role === 'facilitator') {
			//validation to check if the mobile exists for another facilitator

			let query = `query MyQuery {
				users(where: {mobile: {_eq: "${body?.mobile}"}}){
				  id
				  mobile
				  program_faciltators{
					id
					user_id
				  }
				}
			  }
			  `;
			const hasura_response =
				await this.hasuraServiceFromServices.getData({
					query: query,
				});

			let users = hasura_response?.data?.users;

			if (users?.length > 0) {
				let facilitator_data = users.filter(
					(user) => user.program_faciltators.length > 0,
				);

				if (facilitator_data.length > 0) {
					return response.status(422).send({
						success: false,
						message: 'Mobile Number Already Exist',
						data: {},
					});
				}
			}

			// Validate role specific fields
			if (
				!body.role_fields.parent_ip ||
				!body.role_fields.program_id ||
				!body.role_fields.academic_year_id
			) {
				misssingFieldsFlag = true;
			}
		} else if (role === 'beneficiary') {
			// Validate role specific fields
			if (
				!body.role_fields.facilitator_id ||
				!body.role_fields.program_id ||
				!body.role_fields.academic_year_id ||
				!body.role_fields.org_id
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
			username += `${body.last_name.charAt(0)}`;
		}
		username += `${body.mobile}`;
		username = username.toLowerCase();

		// Role to group mapping
		let group = role;

		if (role == 'facilitator') {
			group = `facilitators`;
		} else if (role == 'beneficiary') {
			group = `beneficiaries`;
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

		const token = await this.keycloakService.getAdminKeycloakToken();

		if (token?.access_token) {
			const findUsername = await this.keycloakService.findUser(
				username,
				token?.access_token,
			);

			if (findUsername.length > 0 && group === 'beneficiaries') {
				let lastUsername =
					findUsername[findUsername.length - 1].username;
				//	//console.log('lastUsername', lastUsername);
				let count = findUsername.length;
				//console.log('count', count);
				data_to_create_user.username =
					data_to_create_user.username + '_' + count;
			}

			const registerUserRes = await this.keycloakService.registerUser(
				data_to_create_user,
				token.access_token,
			);

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
				if (body.role_fields.org_id) {
					body.org_id = body.role_fields.org_id;
				}
				if (role === 'facilitator' && body.hasOwnProperty('dob')) {
					delete body.dob;
				}
				body.role = role;

				const result = await this.authService.newCreate(body);
				if (
					role === 'beneficiary' &&
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

				// Send login details SMS
				// नमस्कार, प्रगति प्लेटफॉर्म पर आपका अकाउंट बनाया गया है। आपका उपयोगकर्ता नाम <arg1> है और पासवर्ड <arg2> है। FEGG
				if (body.role === 'facilitator') {
					const message = `%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%95%E0%A4%BE%E0%A4%B0,%20%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%97%E0%A4%A4%E0%A4%BF%20%E0%A4%AA%E0%A5%8D%E0%A4%B2%E0%A5%87%E0%A4%9F%E0%A4%AB%E0%A5%89%E0%A4%B0%E0%A5%8D%E0%A4%AE%20%E0%A4%AA%E0%A4%B0%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%85%E0%A4%95%E0%A4%BE%E0%A4%89%E0%A4%82%E0%A4%9F%20%E0%A4%AC%E0%A4%A8%E0%A4%BE%E0%A4%AF%E0%A4%BE%20%E0%A4%97%E0%A4%AF%E0%A4%BE%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%89%E0%A4%AA%E0%A4%AF%E0%A5%8B%E0%A4%97%E0%A4%95%E0%A4%B0%E0%A5%8D%E0%A4%A4%E0%A4%BE%20%E0%A4%A8%E0%A4%BE%E0%A4%AE%20%3Carg1%3E%20%E0%A4%B9%E0%A5%88%20%E0%A4%94%E0%A4%B0%20%E0%A4%AA%E0%A4%BE%E0%A4%B8%E0%A4%B5%E0%A4%B0%E0%A5%8D%E0%A4%A1%20%3Carg2%3E%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20FEGG`;
					const args = `arg1:${body.username},arg2:${body.password}`;
					const otpRes = await this.authService.sendSMS(
						body.mobile,
						message,
						args,
					);
				}

				let user_id = result?.data?.id;

				if (user_id && role === 'facilitator') {
					// Set the timezone to Indian Standard Time (Asia/Kolkata)
					const formattedISTTime = this.method.getFormattedISTTime();

					// Format the time as per datetime

					let acknowledgement_create_body = {
						user_id: user_id,
						academic_year_id: body?.role_fields?.academic_year_id,
						program_id: body?.role_fields?.program_id,
						date_time: formattedISTTime,
						doc_version: 1,
						doc_id: 1,
						context: 'facilitator.profile',
						context_id: user_id,
						accepted: true,
					};

					//add acknowledgment details
					await this.acknowledgementService.createAcknowledgement(
						acknowledgement_create_body,
					);
				}

				if (role === 'beneficiary' && body?.core_beneficiaries) {
					let core_beneficiary_body = {
						...body?.core_beneficiaries,
						user_id: user_id,
					};

					await this.hasuraService.q(
						'core_beneficiaries',
						{
							...core_beneficiary_body,
						},
						[],
						false,
						['id'],
					);
				}

				if (role === 'beneficiary' && body?.extended_users) {
					let extended_users_body = {
						...body?.extended_users,
						user_id: user_id,
					};

					await this.hasuraService.q(
						'extended_users',
						{
							...extended_users_body,
						},
						[],
						false,
						['id'],
					);
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

	public async validateFields(role, fields) {
		if (role === 'beneficiary') {
			// Define the required fields for the beneficiary role
			const requiredFields = [
				'first_name',
				'middle_name',
				'last_name',
				'mobile',
				'state',
				'district',
				'block',
				'village',
				'grampanchayat',
				'pincode',
				'dob',
				'lat',
				'long',
				'alternative_mobile_number',
				'email_id',
				'address',
			];

			const requiredCoreBeneficiariesFields = [
				'device_type',
				'device_ownership',
				'previous_school_type',
				'last_standard_of_education',
				'reason_of_leaving_education',
				'last_standard_of_education_year',
				'type_of_learner',
				'father_first_name',
				'father_last_name',
				'mother_first_name',
				'mother_last_name',
				'father_middle_name',
				'mother_middle_name',
				'career_aspiration_details',
				'mark_as_whatsapp_number',
				'parent_support',
				'career_aspiration',
			];

			const requiredExtendedUsersFields = [
				'marital_status',
				'social_category',
			];

			const requiredProgramBeneficiariesFields = [
				'learning_motivation',
				'type_of_support_needed',
				'learning_level',
			];

			// Check for core_beneficiaries
			if (!fields.hasOwnProperty('core_beneficiaries')) {
				//	throw new Error('Field "core_beneficiaries" is missing');
				return {
					status: false,
					message: 'Field core_beneficiaries is missing',
				};
			}

			if (!fields.hasOwnProperty('program_beneficiaries')) {
				return {
					status: false,
					message: 'Field program_beneficiaries is missing',
				};
			}

			if (!fields.hasOwnProperty('extended_users')) {
				return {
					status: false,
					message: 'Field extended_users is missing',
				};
			}

			// Validate fields inside core_beneficiaries
			for (const field of requiredCoreBeneficiariesFields) {
				if (!fields.core_beneficiaries.hasOwnProperty(field)) {
					return {
						status: false,
						message: `Field "core_beneficiaries.${field}" is missing`,
					};
				}
			}

			for (const field of requiredExtendedUsersFields) {
				if (!fields.extended_users.hasOwnProperty(field)) {
					return {
						status: false,
						message: `Field "extended_users.${field}" is missing`,
					};
				}
			}

			for (const field of requiredProgramBeneficiariesFields) {
				if (!fields.program_beneficiaries.hasOwnProperty(field)) {
					return {
						status: false,
						message: `Field "program_beneficiaries.${field}" is missing`,
					};
				}
			}

			// Validate fields outside core_beneficiaries
			for (const field of requiredFields) {
				if (!fields.hasOwnProperty(field)) {
					return {
						status: false,
						message: `Field "${field}" is missing`,
					};
				}
			}

			return {
				status: true,
			}; // If all fields are valid
		} else {
			throw new Error(`Role "${role}" is not supported`);
		}
	}

	public async isUserExists(body, response) {
		let { first_name, dob, mobile } = body;
		let filterQueryArray = [];

		filterQueryArray.push(
			`soundex(first_name) = soundex('${first_name}')  AND dob = '${dob}'`,
		);

		if (body?.last_name) {
			filterQueryArray.push(
				`soundex(last_name) = soundex('${body.last_name}')`,
			);
		}

		if (body?.middle_name) {
			filterQueryArray.push(
				`soundex(middle_name) = soundex('${body.middle_name}')`,
			);
		}

		const filterQuery = `SELECT mobile,id FROM users WHERE ${filterQueryArray.join(
			' AND ',
		)}`;

		const users_data = (
			await this.hasuraServiceFromServices.executeRawSql(filterQuery)
		)?.result;

		if (users_data == undefined && !users_data) {
			return response.status(200).json({
				message: 'No Data found',
				status: 'success',
				is_mobile_found: false,
			});
		}

		let result =
			this.hasuraServiceFromServices.getFormattedData(users_data);

		// Check if the mobile number sent in the body is present in the result array
		const mobileFound = result.some((user) => user.mobile === mobile);

		if (mobileFound) {
			return response.status(200).json({
				message: 'Data found successfully',
				status: 'success',
				is_mobile_found: true,
				is_data_found: true,
			});
		} else {
			return response.status(200).json({
				message:
					result?.length > 0
						? 'Data found successfully'
						: 'Data not found',
				status: 'success',
				is_mobile_found: false,
				is_data_found: result?.length > 0 ? true : false,
			});
		}
	}

	public async fileUrlToBase64(imageUrl: string): Promise<string> {
		try {
			const response = await fetch(imageUrl);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);
			const base64Data = buffer.toString('base64');
			const fileType = response.headers.get('content-type'); // Get the content type from the response headers
			const base64String = `data:${fileType};base64,${base64Data}`; // Include the content type in the Base64 string
			return base64String;
		} catch (error) {
			//console.error('Error converting image to Base64:', error);
			return null;
		}
	}

	public async getUserInfoDetails(request, response) {
		let user_id = request.mw_userid; //get user id from token
		let program_id = request?.mw_program_id; // get program_id from token
		let academic_year_id = request?.mw_academic_year_id; // get academic_year_id from token

		//query to get user details information
		////console.log('user_id', user_id);

		let query = `query MyQuery {
			users_by_pk(id:${user_id}) {
			  id
			  first_name
			  middle_name
			  last_name
			  dob
			  aadhar_no
			  mobile
			  alternative_mobile_number
			  email_id
			  state
			  district
			  block
			  grampanchayat
			  village
			  pincode
			  gender
			  username
			  mobile_no_verified
			  long
			  lat
			  keycloak_id
			  is_deactivated
			  is_duplicate
			  email_verified
			  duplicate_reason
			  aadhar_verified
			  aadhar_token
			  aadhaar_verification_mode
			  profile_photo_1
			  profile_photo_1_documents: documents(where: {document_sub_type: {_eq: "profile_photo_1"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  profile_photo_2
			  profile_photo_2_documents: documents(where: {document_sub_type: {_eq: "profile_photo_2"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  profile_photo_3
			  profile_photo_3_documents: documents(where: {document_sub_type: {_eq: "profile_photo_3"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  core_faciltator {
				device_type
				device_ownership
				has_diploma
				diploma_details
				pan_no
				sourcing_channel
				has_job_exp
				has_volunteer_exp
			  }
			  extended_users {
				marital_status
				social_category
				designation
				qualification_id
			  }
			  references(where: {context: {_eq: "users"}}) {
				name
				designation
				contact_number
				context
			  }
			  program_faciltators(where: {academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}}) {
				id
				parent_ip
				documents_status
				has_social_work_exp
                police_verification_done
				social_background_verified_by_neighbours
				village_knowledge_test
				status
				form_step_number 
				availability
				qualification_ids
			  }
			  experience(where: {type: {_in: ["experience","vo_experience"]}}) {
				id
				type
				role_title
				organization
				description
				experience_in_years
				related_to_teaching
				references(where: {context: {_eq: "experience"}}) {
			      id
				  name
				  contact_number
				  type_of_document
				  document_id
				  document_reference {
					document_id: id
					name
					document_sub_type
					doument_type
					path
					provider
					context
					context_id
				  }
				}
			  }
			  qualifications{
				id
				end_year
				institution
				start_year
				qualification_master_id
				qualification_reference_document_id
				document_reference{
				  document_id:id
				  name
				  path
				  provider
				  context
				  context_id
				}
			    qualification_master{
				context
				context_id
				created_by
				id
				name
				type
				updated_by
			  }
			}
		}
		  }
		  `;

		const hasura_response = await this.hasuraServiceFromServices.getData({
			query: query,
		});

		let user_data = hasura_response?.data;

		////console.log('user_data', JSON.stringify(user_data));

		// get profile photo document details
		let profilePhoto1Documents =
			user_data?.users_by_pk?.profile_photo_1_documents;

		let profilePhoto2Documents =
			user_data?.users_by_pk?.profile_photo_2_documents;

		let profilePhoto3Documents =
			user_data?.users_by_pk?.profile_photo_3_documents;

		//  modifiy individual profile photo document details as required

		// get file url and convert to base64
		let data_base64_profile_1 = null;
		let profile_photo_1_info = {};
		if (profilePhoto1Documents?.[0]) {
			const profile_photo_1_file_Url = await this.s3Service.getFileUrl(
				profilePhoto1Documents?.[0]?.name,
			);
			data_base64_profile_1 = await this.fileUrlToBase64(
				profile_photo_1_file_Url,
			);
			profile_photo_1_info = {
				name: user_data?.users_by_pk?.profile_photo_1,
				documents: {
					base64: data_base64_profile_1,
					document_id: profilePhoto1Documents?.[0]?.document_id,
					name: profilePhoto1Documents?.[0]?.name,
					document_type: profilePhoto1Documents?.[0]?.doument_type,
					document_sub_type:
						profilePhoto1Documents?.[0]?.document_sub_type,
					path: profilePhoto1Documents?.[0]?.path,
					provider: profilePhoto1Documents?.[0]?.provider,
					context: profilePhoto1Documents?.[0]?.context,
					context_id: profilePhoto1Documents?.[0]?.context_id,
				},
			};
		}
		let data_base64_profile_2 = null;
		let profile_photo_2_info = {};
		if (profilePhoto2Documents?.[0]) {
			const profile_photo_2_file_Url = await this.s3Service.getFileUrl(
				profilePhoto2Documents?.[0]?.name,
			);
			data_base64_profile_2 = await this.fileUrlToBase64(
				profile_photo_2_file_Url,
			);
			profile_photo_2_info = {
				name: user_data?.users_by_pk?.profile_photo_2,
				documents: {
					base64: data_base64_profile_2,
					document_id: profilePhoto2Documents?.[0]?.document_id,
					name: profilePhoto2Documents?.[0]?.name,
					document_type: profilePhoto2Documents?.[0]?.doument_type,
					document_sub_type:
						profilePhoto2Documents?.[0]?.document_sub_type,
					path: profilePhoto2Documents?.[0]?.path,
					provider: profilePhoto2Documents?.[0]?.provider,
					context: profilePhoto2Documents?.[0]?.context,
					context_id: profilePhoto2Documents?.[0]?.context_id,
				},
			};
		}
		let data_base64_profile_3 = null;
		let profile_photo_3_info = {};
		if (profilePhoto3Documents?.[0]) {
			const profile_photo_3_file_Url = await this.s3Service.getFileUrl(
				profilePhoto3Documents?.[0]?.name,
			);
			data_base64_profile_3 = await this.fileUrlToBase64(
				profile_photo_3_file_Url,
			);
			profile_photo_3_info = {
				name: user_data?.users_by_pk?.profile_photo_3,
				documents: {
					base64: data_base64_profile_3,
					document_id: profilePhoto3Documents?.[0]?.document_id,
					name: profilePhoto3Documents?.[0]?.name,
					document_type:
						profilePhoto3Documents?.[0]?.doument_type || null,
					document_sub_type:
						profilePhoto3Documents?.[0]?.document_sub_type,
					path: profilePhoto3Documents?.[0]?.path,
					provider: profilePhoto3Documents?.[0]?.provider,
					context: profilePhoto3Documents?.[0]?.context,
					context_id: profilePhoto3Documents?.[0]?.context_id,
				},
			};
		}

		if (!user_data?.users_by_pk) {
			user_data.users_by_pk = {}; // Initialize as an empty object if it doesn't exist
		}
		// Replacing profile_photo_documents with profile_photo for all details
		user_data.users_by_pk.profile_photo_1 = profile_photo_1_info;
		user_data.users_by_pk.profile_photo_2 = profile_photo_2_info;
		user_data.users_by_pk.profile_photo_3 = profile_photo_3_info;

		// Removing profile_photo_documents object
		delete user_data.users_by_pk.profile_photo_1_documents;
		delete user_data.users_by_pk.profile_photo_2_documents;
		delete user_data.users_by_pk.profile_photo_3_documents;

		// update experience format
		let experience_format = [];
		if (user_data?.users_by_pk?.experience.length > 0) {
			for (
				let i = 0;
				i <= user_data?.users_by_pk?.experience.length;
				i++
			) {
				let obj_experience = user_data?.users_by_pk?.experience[i];
				let obj_reference = obj_experience?.references[0];
				let temp_reference = {};
				if (obj_reference) {
					let obj_document = obj_reference?.document_reference;
					let temp_document = {};
					if (obj_document) {
						let exp_document_base64 = null;
						let obj_document_name = obj_document?.name;
						if (obj_document_name) {
							let obj_document_url =
								await this.s3Service.getFileUrl(
									obj_document_name,
								);
							exp_document_base64 = await this.fileUrlToBase64(
								obj_document_url,
							);
						}
						temp_document = {
							base64: exp_document_base64,
							document_id: obj_document?.document_id,
							name: obj_document?.name,
							document_sub_type: obj_document?.document_sub_type,
							doument_type: obj_document?.doument_type,
							path: obj_document?.path,
							provider: obj_document?.provider,
							context: obj_document?.context,
							context_id: obj_document?.context_id,
						};
					}
					temp_reference = {
						id: obj_reference?.id,
						name: obj_reference?.name,
						contact_number: obj_reference?.contact_number,
						type_of_document: obj_reference?.type_of_document,
						document_id: obj_reference?.document_id,
						documents: temp_document,
					};
				}
				let temp_experience = {
					id: obj_experience?.id,
					type: obj_experience?.type,
					role_title: obj_experience?.role_title,
					organization: obj_experience?.organization,
					description: obj_experience?.description,
					experience_in_years: obj_experience?.experience_in_years,
					related_to_teaching: obj_experience?.related_to_teaching,
					references: temp_reference,
				};
				experience_format.push(temp_experience);
			}
		}
		user_data.users_by_pk.experience = experience_format;

		//update qualification format
		let base64Qualifications = null;
		let qualification_doc_name =
			user_data.users_by_pk?.qualifications[0]?.document_reference?.name;
		if (qualification_doc_name) {
			let qualification_file_url = await this.s3Service.getFileUrl(
				qualification_doc_name,
			);
			base64Qualifications = await this.fileUrlToBase64(
				qualification_file_url,
			);
		}
		user_data.users_by_pk.qualifications =
			user_data?.users_by_pk?.qualifications?.reduce((acc, q) => {
				const documents = q.document_reference
					? {
							base64: base64Qualifications,
							document_id: q?.document_reference?.document_id,
							name: q?.document_reference?.name,
							path: q?.document_reference?.path,
							provider: q?.document_reference?.provider,
							context: q?.document_reference?.context,
							context_id: q?.document_reference?.context_id,
					  }
					: {};

				delete q.document_reference; // Remove document_reference

				// Update accumulator with updated qualification object
				return { ...acc, ...q, documents };
			}, {});

		user_data.users_by_pk.program_faciltators =
			user_data?.users_by_pk?.program_faciltators?.reduce((acc, pf) => {
				pf ? pf : {};

				return { ...acc, ...pf };
			}, {});

		user_data.users_by_pk.references =
			user_data?.users_by_pk?.references?.reduce((acc, rf) => {
				rf ? rf : {};

				return { ...acc, ...rf };
			}, {});

		const {
			first_name,
			middle_name,
			last_name,
			dob,
			aadhar_no,
			mobile,
			alternative_mobile_number,
			email_id,
			state,
			district,
			block,
			grampanchayat,
			village,
			pincode,
			gender,
			profile_photo_1,
			profile_photo_2,
			profile_photo_3,
			username,
			mobile_no_verified,
			long,
			lat,
			keycloak_id,
			is_deactivated,
			is_duplicate,
			email_verified,
			duplicate_reason,
			aadhar_verified,
			aadhar_token,
			aadhaar_verification_mode,
			id,
		} = user_data?.users_by_pk || {};

		const formattedData = {
			users: {
				first_name,
				middle_name,
				last_name,
				dob,
				aadhar_no,
				mobile,
				alternative_mobile_number,
				email_id,
				state,
				district,
				block,
				grampanchayat,
				village,
				pincode,
				gender,
				profile_photo_1,
				profile_photo_2,
				profile_photo_3,
				username,
				mobile_no_verified,
				long,
				lat,
				keycloak_id,
				is_deactivated,
				is_duplicate,
				email_verified,
				duplicate_reason,
				aadhar_verified,
				aadhar_token,
				aadhaar_verification_mode,
				id,
			},
			core_faciltators: user_data?.users_by_pk?.core_faciltator || {},
			extended_users: user_data?.users_by_pk?.extended_users || {},
			references: user_data?.users_by_pk?.references,
			program_faciltators: user_data?.users_by_pk?.program_faciltators,
			experience: user_data?.users_by_pk?.experience,
			qualifications: user_data?.users_by_pk?.qualifications,
			qualification_master: user_data?.users_by_pk?.qualification_master,
		};

		if (user_data) {
			return response.status(200).json({
				message: 'Data retrieved successfully!',
				data: formattedData,
			});
		}
	}

	public async userOnboarding(body: any, response: any, request: any) {
		//first check validations for all inputs
		let jsonContent;
		//console.log('body-->', body);

		try {
			// Convert buffer to JSON object
			jsonContent = JSON.parse(body.buffer.toString('utf8'));

			// Process JSON content

			// Return success message
		} catch (error) {
			console.error('Error parsing JSON:', error);
		}

		let user_id = request?.mw_userid;
		let program_id = request?.mw_program_id;
		let academic_year_id = request?.mw_academic_year_id;

		let result = await this.processTable(
			jsonContent,
			user_id,
			program_id,
			academic_year_id,
			response,
		);

		//console.log('result-->>', result);
		if (result) {
			return response.status(200).json({
				result: result,
			});
		}
	}

	private async processTable(
		json: any,
		user_id: any,
		program_id: any,
		academic_year_id: any,
		resp?: any,
	) {
		let tableFields;
		let tableName;
		let set_update;
		let update_id;
		let profile_photo_fields_1;
		let documents_fields_1;
		let profile_photo_fields_2;
		let documents_fields_2;
		let profile_photo_fields_3;
		let documents_fields_3;
		let profile_photo_1_value;
		let documents_values_1;
		let profile_photo_2_value;
		let documents_values_2;
		let profile_photo_3_value;
		let documents_values_3;
		let profile_documents_array = [];
		let qualification_document_data;
		let resultArray = [];
		let upsert_records_result;
		let base64result;
		for (const key in json) {
			const value = json[key];
			if (!(Object.keys(value).length === 0)) {
				//console.log('value-->>', value);
				if (typeof value === 'object') {
					tableName = key;
					tableFields = Object.keys(value);
					for (const subKey in value) {
						const subValue = value[subKey];

						if (typeof subValue === 'object') {
							if (subKey.startsWith('profile_photo_')) {
								const profilePhotoValue =
									Object.values(subValue);
								const documentsValues = Object.values(
									subValue.documents,
								);
								const base64 = documentsValues?.[0];
								const documentDetails = {
									document_type: 'profile_photo',
									document_sub_type: subKey,
								};

								if (base64) {
									await this.base64ToBlob(
										base64,
										user_id,
										resp,
										documentDetails,
									);
								}

								// Add profile photo with its name value for inserting in users table
								value[subKey] = profilePhotoValue?.[0];
							}
						}
					}
				}

				if (Array.isArray(value)) {
					// Handle array
					tableName = key;
					let tempvalue = [];

					for (let i = 0; i < value.length; i++) {
						let tempobj = value[i];
						delete tempobj.status;
						delete tempobj.unique_key;
						tempvalue.push(tempobj);
					}
					await this.processJsonArray(
						tempvalue,
						tableName,
						user_id,
						resultArray,
						resp,
					);
				}

				if (tableName != 'users' && tableName != 'references') {
					value.user_id = user_id;
					tableFields.push('user_id');
				}

				if (tableName === 'users') {
					if (typeof value?.alternative_mobile_number === 'string') {
						value.alternative_mobile_number = null;
					}
				}

				if (tableName == 'program_faciltators') {
					//console.log('vlaues-->>', value);

					value.program_id = program_id;
					value.academic_year_id = academic_year_id;
					try {
						value.qualification_ids = JSON.stringify(
							JSON.parse(value?.qualification_ids),
						).replace(/"/g, '\\"');
					} catch (e) {}

					tableFields.push('program_id');
					tableFields.push('academic_year_id');
					//console.log('vlaues123-->>', value);
				}

				if (tableName == 'references') {
					value.context_id = user_id;
					tableFields.push('context_id');
					value.context = 'users';
					tableFields.push('context');
					value.program_id = program_id;
					value.academic_year_id = academic_year_id;
					tableFields.push('program_id');
					tableFields.push('academic_year_id');
				}

				if (tableName == 'qualifications') {
					//console.log('qualvalue-->', value);
					if (value?.documents) {
						let base64 = value?.documents?.base64;

						//console.log('base64-->>', base64);
						let document_details = {
							document_type: 'qualifications',
							document_sub_type: 'qualifications',
							context: 'qualifications',
						};

						if (base64) {
							base64result = await this.base64ToBlob(
								base64,
								user_id,
								resp,
								document_details,
							);
						}
					}

					//console.log('base64result-->.', base64result);

					value['qualification_reference_document_id'] =
						base64result?.document_id;
					tableFields = tableFields?.filter(
						(field) => field !== 'documents',
					);
					delete value?.documents;
					//console.log('qualvalue123-->', value);
				}

				let response = await this.findExisitingReccord(
					tableName,
					value,
					user_id,
				);

				set_update = response?.set_update;
				update_id = response?.id;

				if (tableName != 'experience') {
					upsert_records_result = await this.upsertRecords(
						set_update,
						tableName,
						tableFields,
						value,
						user_id,
						update_id,
					);

					if (upsert_records_result?.[tableName]?.extensions) {
						resultArray.push({
							[tableName]: {
								status: false,
								message:
									upsert_records_result?.[tableName]?.message,
							},
						});
					} else {
						resultArray.push({
							[tableName]: {
								status: true,
								message: 'successfully updated the value',
							},
						});
					}
				}

				//console.log('upsert_records_result-->>', upsert_records_result);
			}
		}

		return resultArray;
	}

	public async processJsonArray(
		values,
		tableName,
		user_id,
		resultArray?,
		resp?,
	) {
		let set_update;
		let update_id;
		let referenceFields;
		let referenceData;
		let documentFields;
		let documentData;
		let result;
		let base64result;

		for (const obj of values) {
			let tableFields = Object.keys(obj);
			tableFields.push('user_id');
			obj.user_id = user_id;

			set_update = obj?.id ? 1 : 0;
			update_id = obj?.id;

			//console.log('set->.', set_update);
			if (set_update == 1) {
				tableFields.push('id');
			}

			if (tableName == 'experience') {
				if ('references' in obj) {
					// Process 'references' array differently
					referenceFields = [
						'name',
						'contact_number',
						'type_of_document',
						'context',
						'context_id',
					];
					referenceData = {
						name: obj?.references.name,
						contact_number: obj?.references.contact_number,
						type_of_document: obj?.references.type_of_document,
						context: 'experience',
						context_id: obj?.id,
					};

					if (set_update == 1) {
						referenceData.context_id = obj?.id;
						referenceData['id'] = obj?.references?.id;
					}
				}

				if ('documents' in obj.references) {
					let base64 = obj.references?.documents?.base64;

					//console.log('base64-->>', base64);
					let document_details = {
						document_type: 'reference',
						document_sub_type: 'reference',
						context: 'experience',
					};

					if (base64) {
						base64result = await this.base64ToBlob(
							base64,
							user_id,
							resp,
							document_details,
						);
					}

					referenceData['document_id'] = base64result?.document_id;
					referenceFields.push('document_id');

					tableFields = tableFields?.filter(
						(field) => field !== 'documents',
					);
				}

				// remove references object from the main object to process the experience object
				tableFields = tableFields?.filter(
					(field) => field !== 'references',
				);
				delete obj?.references;
			}

			//console.log('referenceData-->>', referenceData);

			result = await this.upsertRecords(
				set_update,
				tableName,
				tableFields,
				obj,
				user_id,
				update_id,
			);

			if (tableName == 'experience' && referenceData) {
				let update_id = referenceData?.id;
				set_update = update_id ? 1 : 0;
				if (!obj?.id) {
					referenceData.context_id = result?.experience?.id;
				}
				let result1 = await this.upsertRecords(
					set_update,
					'references',
					referenceFields,
					referenceData,
					user_id,
					update_id,
				);

				//console.log('references result--->>', result1);
			}

			if (result?.[tableName]?.extensions) {
				resultArray.push({
					[tableName]: {
						status: false,
						message: result?.[tableName]?.message,
					},
				});
			} else {
				resultArray.push({
					[tableName]: {
						status: true,
						message: 'successfully updated the value',
					},
				});
			}
		}
	}

	public async findExisitingReccord(tablename, value, user_id) {
		let query;
		let response;

		switch (tablename) {
			case 'users': {
				query = `query MyQuery {
					users(where: {id: {_eq:${user_id}}}){
						id,
						mobile
					}
				}`;

				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update: response?.data?.users?.length > 0 ? 1 : 0,
					id: response?.data?.users?.[0]?.id,
				};
			}
			case 'core_faciltators': {
				query = `query MyQuery {
					core_faciltators(where: {user_id: {_eq:${user_id}}}){
					  id
					}
				  }
				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update:
						response?.data?.core_faciltators?.length > 0 ? 1 : 0,
					id: response?.data?.core_faciltators?.[0]?.id,
				};
			}
			case 'extended_users': {
				query = `query MyQuery {
					extended_users(where: {user_id: {_eq:${user_id}}}){
					  id
					}
				  }

				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update:
						response?.data?.extended_users?.length > 0 ? 1 : 0,
					id: response?.data?.extended_users?.[0]?.id,
				};
			}
			case 'program_faciltators': {
				query = `query MyQuery {
					program_faciltators(where: {user_id: {_eq:${user_id}},program_id:{_eq:${value?.program_id}},academic_year_id:{_eq:${value?.academic_year_id}}}){
					  id
					}
				  }

				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update:
						response?.data?.program_faciltators?.length > 0 ? 1 : 0,
					id: response?.data?.program_faciltators?.[0]?.id,
				};
			}
			case 'references': {
				query = `query MyQuery {
					references(where: {contact_number: {_eq:${value?.contact_number}},context_id:{_eq:${user_id}}}){
					  id
					}
				  }

				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update: response?.data?.references?.length > 0 ? 1 : 0,
					id: response?.data?.references?.[0]?.id,
				};
			}
			case 'qualifications': {
				query = `query MyQuery {
					qualifications(where: {user_id: {_eq:${user_id}}}){
					  id
					}
				  }
				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update:
						response?.data?.qualifications?.length > 0 ? 1 : 0,
					id: response?.data?.qualifications?.[0]?.id,
				};
			}
			case 'experience': {
				query = `query MyQuery {
					experience(where: {user_id: {_eq:${user_id}},type:{_eq:${value?.type}}}){
					  id
					}
				  }
				  `;
				response = await this.hasuraServiceFromServices.getData({
					query: query,
				});

				return {
					set_update: response?.data?.experience?.length > 0 ? 1 : 0,
					id: response?.data?.experience?.[0]?.id,
				};
			}

			default:
				return undefined;
		}
	}

	public async upsertRecords(
		set_update,
		tableName,
		tableFields,
		value,
		user_id,
		id?,
	) {
		let result;
		//console.log('value-->>', value);
		if (set_update == 1 && id) {
			result = await this.hasuraService.q(
				tableName,
				{
					...value,
					id: id,
				},
				tableFields,
				true,
				[tableFields],
			);
		} else {
			result = await this.hasuraService.q(
				tableName,
				{
					...value,
				},
				tableFields,
				false,
				[tableFields],
			);
		}

		return result;
	}

	public async upsertProfileDocuments(profileDocumentArray) {
		for (const profileDocument of profileDocumentArray) {
			let result = await this.hasuraService.q(
				'documents',
				{
					...profileDocument,
					id: profileDocument.document_id,
				},
				['name', 'document_sub_type', 'doument_type', 'id'],
				true,
				['name', 'document_sub_type', 'doument_type', 'id'],
			);

			//console.log('resuklt-->>', result);
		}
	}

	public async getUserInfoDetailsForBeneficiary(
		request,
		response,
		userid: any,
	) {
		let user_id = userid; //get user id from token
		let program_id = request?.mw_program_id; // get program_id from token
		let academic_year_id = request?.mw_academic_year_id; // get academic_year_id from token

		//query to get user details information

		let query = `query MyQuery {
			users_by_pk(id:${user_id}) {
			  first_name
			  middle_name
			  last_name
			  dob
			  aadhar_no
			  mobile
			  alternative_mobile_number
			  email_id
			  state
			  district
			  block
			  grampanchayat
			  village
			  pincode
			  gender
			  profile_photo_1
			  profile_photo_2
			  profile_photo_3
			  username
			  mobile_no_verified
			  long
			  lat
			  keycloak_id
			  is_deactivated
			  is_duplicate
			  email_verified
			  duplicate_reason
			  aadhar_verified
			  aadhar_token
			  aadhaar_verification_mode
			  id
			  profile_photo_1
			  profile_photo_1_documents: documents(where: {document_sub_type: {_eq: "profile_photo_1"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  profile_photo_2
			  profile_photo_2_documents: documents(where: {document_sub_type: {_eq: "profile_photo_2"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  profile_photo_3
			  profile_photo_3_documents: documents(where: {document_sub_type: {_eq: "profile_photo_3"}}) {
				name
				doument_type
				document_sub_type
				document_id: id
				path
				provider
				context
				context_id
			  }
			  core_beneficiaries {
				career_aspiration
				career_aspiration_details
				device_ownership
				device_type
				type_of_learner
				last_standard_of_education_year
				last_standard_of_education
				previous_school_type
				reason_of_leaving_education
				education_10th_exam_year
				alternative_device_ownership
				alternative_device_type
				mother_first_name
				mother_middle_name
				mother_last_name
				father_first_name
				father_middle_name
				father_last_name
			  }
			  extended_users {
				marital_status
				social_category
			  }
			  program_beneficiaries(where: {academic_year_id: {_eq:${academic_year_id}}, program_id: {_eq:${program_id}}}) {
				learning_level
				learning_motivation
				type_of_support_needed
				facilitator_id
				status
				exam_fee_document_id
				exam_fee_date
				syc_subjects
				is_continued
			  }
			  references {
				first_name
				last_name
				middle_name
				relation
				contact_number
				context
				context_id
			  }
			}
		  }
		  
		  
		  `;

		const hasura_response = await this.hasuraServiceFromServices.getData({
			query: query,
		});

		let user_data = hasura_response?.data;

		// get profile photo document details
		let profilePhoto1Documents =
			user_data?.users_by_pk?.profile_photo_1_documents;

		let profilePhoto2Documents =
			user_data?.users_by_pk?.profile_photo_2_documents;

		let profilePhoto3Documents =
			user_data?.users_by_pk?.profile_photo_3_documents;

		//  modifiy individual profile photo document details as required

		let profile_photo_1_info = {
			name: user_data?.users_by_pk?.profile_photo_1,
			documents: {
				base64: null,
				document_id: profilePhoto1Documents?.[0]?.document_id,
				name: profilePhoto1Documents?.[0]?.name,
				document_type: profilePhoto1Documents?.[0]?.doument_type,
				document_sub_type:
					profilePhoto1Documents?.[0]?.document_sub_type,
				path: profilePhoto1Documents?.[0]?.path,
				provider: profilePhoto1Documents?.[0]?.provider,
				context: profilePhoto1Documents?.[0]?.context,
				context_id: profilePhoto1Documents?.[0]?.context_id,
			},
		};

		let profile_photo_2_info = {
			name: user_data?.users_by_pk?.profile_photo_2,
			documents: {
				base64: null,
				document_id: profilePhoto2Documents?.[0]?.document_id,
				name: profilePhoto2Documents?.[0]?.name,
				document_type: profilePhoto2Documents?.[0]?.doument_type,
				document_sub_type:
					profilePhoto2Documents?.[0]?.document_sub_type,
				path: profilePhoto2Documents?.[0]?.path,
				provider: profilePhoto2Documents?.[0]?.provider,
				context: profilePhoto2Documents?.[0]?.context,
				context_id: profilePhoto2Documents?.[0]?.context_id,
			},
		};

		let profile_photo_3_info = {
			name: user_data?.users_by_pk?.profile_photo_3,
			documents: {
				base64: null,
				document_id: profilePhoto3Documents?.[0]?.document_id,
				name: profilePhoto3Documents?.[0]?.name,
				document_type:
					profilePhoto3Documents?.[0]?.doument_type || null,
				document_sub_type:
					profilePhoto3Documents?.[0]?.document_sub_type,
				path: profilePhoto3Documents?.[0]?.path,
				provider: profilePhoto3Documents?.[0]?.provider,
				context: profilePhoto3Documents?.[0]?.context,
				context_id: profilePhoto3Documents?.[0]?.context_id,
			},
		};

		if (!user_data?.users_by_pk) {
			user_data.users_by_pk = {}; // Initialize as an empty object if it doesn't exist
		}
		// Replacing profile_photo_documents with profile_photo for all details
		user_data.users_by_pk.profile_photo_1 = profile_photo_1_info;
		user_data.users_by_pk.profile_photo_2 = profile_photo_2_info;
		user_data.users_by_pk.profile_photo_3 = profile_photo_3_info;

		// Removing profile_photo_documents object
		delete user_data.users_by_pk.profile_photo_1_documents;
		delete user_data.users_by_pk.profile_photo_2_documents;
		delete user_data.users_by_pk.profile_photo_3_documents;

		user_data.users_by_pk.program_beneficiaries =
			user_data?.users_by_pk?.program_beneficiaries?.reduce((acc, pb) => {
				pb ? pb : {};

				return { ...acc, ...pb };
			}, {});

		user_data.users_by_pk.references =
			user_data?.users_by_pk?.references?.reduce((acc, rf) => {
				rf ? rf : {};

				return { ...acc, ...rf };
			}, {});

		const {
			first_name,
			middle_name,
			last_name,
			dob,
			aadhar_no,
			mobile,
			alternative_mobile_number,
			email_id,
			state,
			district,
			block,
			grampanchayat,
			village,
			pincode,
			gender,
			profile_photo_1,
			profile_photo_2,
			profile_photo_3,
			username,
			mobile_no_verified,
			long,
			lat,
			keycloak_id,
			is_deactivated,
			is_duplicate,
			email_verified,
			duplicate_reason,
			aadhar_verified,
			aadhar_token,
			aadhaar_verification_mode,
			id,
		} = user_data?.users_by_pk || {};

		const formattedData = {
			users: {
				first_name,
				middle_name,
				last_name,
				dob,
				aadhar_no,
				mobile,
				alternative_mobile_number,
				email_id,
				state,
				district,
				block,
				grampanchayat,
				village,
				pincode,
				gender,
				profile_photo_1,
				profile_photo_2,
				profile_photo_3,
				username,
				mobile_no_verified,
				long,
				lat,
				keycloak_id,
				is_deactivated,
				is_duplicate,
				email_verified,
				duplicate_reason,
				aadhar_verified,
				aadhar_token,
				aadhaar_verification_mode,
				id,
			},
			core_beneficiaries: user_data?.users_by_pk?.core_beneficiaries,
			extended_users: user_data?.users_by_pk?.extended_users,
			references: user_data?.users_by_pk?.references,
			program_beneficiaries:
				user_data?.users_by_pk?.program_beneficiaries,
		};

		if (user_data) {
			return response.status(200).json({
				message: 'Data retrieved successfully!',
				data: formattedData,
			});
		}
	}

	public async base64ToBlob(base64, userId, res, documentDetails) {
		//console.log('here-->>');
		let fileObject;
		const arr = base64.split(',');
		const mime = arr[0].match(/:(.*?);/)[1];
		const buffer = Buffer.from(arr[1], 'base64');
		let { document_type, document_sub_type } = documentDetails;

		// Generate a unique filename with timestamp and userId
		const now = new Date();
		const formattedDateTime = now
			.toISOString()
			.slice(0, 19)
			.replace('T', '-'); // YYYY-MM-DD-HH-MM-SS format
		const filename = `${userId}-${formattedDateTime}.${mime.split('/')[1]}`; // Extract file extension

		fileObject = {
			fieldname: 'file',
			mimetype: mime,
			encoding: '7bit',
			originalname: filename,
			buffer: buffer,
		};
		let uploadresponse = await this.uploadFileService.addFile(
			fileObject,
			userId,
			document_type,
			document_sub_type,
			res,
			true,
		);

		//console.log(
		//	'response of file upload-->>',
		//	JSON.stringify(uploadresponse),
		//	);
		let document_id: any; // Adjust the type as per your requirement

		if ('data' in uploadresponse && uploadresponse.data) {
			document_id =
				uploadresponse.data.data?.insert_documents?.returning[0]?.id;
		} else {
			// Handle the case where 'data' property is not present
			// or uploadresponse.data is null/undefined
			document_id = null; // Or any other fallback value
		}
		return {
			data: buffer,
			filename,
			mimeType: mime,
			document_id: document_id,
		};
	}

	//Register volunteer
	public async volunteerRegister(body, response, role) {
		let misssingFieldsFlag = false;
		const requiredFields = [
			'first_name',
			'last_name',
			'gender',
			'mobile',
			'email_id',
			'dob',
			'state',
			'pincode',
			'qualification',
		];

		// Check for missing required fields
		const missingFields = requiredFields.filter(
			(field) =>
				!body[field] ||
				(typeof body[field] === 'string' && body[field]?.trim() === ''),
		);
		if (missingFields.length > 0) {
			return response.status(400).json({
				success: false,
				message: `Missing required fields: ${missingFields.join(', ')}`,
			});
		}
		if (role === 'volunteer') {
			//validation to check if the mobile exists for another facilitator

			let query = `query MyQuery {
				users(where: {mobile: {_eq: "${body?.mobile}"}}){
				  id
				  mobile
				}
			  }
			  `;
			const hasura_response =
				await this.hasuraServiceFromServices.getData({
					query: query,
				});

			let users = hasura_response?.data?.users;

			// Generate random password
			const password = `@${this.userHelperService.generateRandomPassword()}`;

			// Generate username
			let username = `${body.first_name}`;
			if (body?.last_name) {
				username += `${body.last_name.charAt(0)}`;
			}
			username += `${body.mobile}_v`;
			username = username.toLowerCase();

			// Role to group mapping
			let group = role;

			if (role == 'volunteer') {
				group = `volunteer`;
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

			const token = await this.keycloakService.getAdminKeycloakToken();

			if (token?.access_token) {
				const findUsername = await this.keycloakService.findUser(
					username,
					token?.access_token,
				);
				const registerUserRes = await this.keycloakService.registerUser(
					data_to_create_user,
					token.access_token,
				);

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
					let role_id;

					body.role = role;

					const result = await this.authService.newCreate(body);
					// Send login details SMS
					// नमस्कार, प्रगति प्लेटफॉर्म पर आपका अकाउंट बनाया गया है। आपका उपयोगकर्ता नाम <arg1> है और पासवर्ड <arg2> है। FEGG
					if (body.role === 'volunteer') {
						const message = `%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%95%E0%A4%BE%E0%A4%B0,%20%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%97%E0%A4%A4%E0%A4%BF%20%E0%A4%AA%E0%A5%8D%E0%A4%B2%E0%A5%87%E0%A4%9F%E0%A4%AB%E0%A5%89%E0%A4%B0%E0%A5%8D%E0%A4%AE%20%E0%A4%AA%E0%A4%B0%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%85%E0%A4%95%E0%A4%BE%E0%A4%89%E0%A4%82%E0%A4%9F%20%E0%A4%AC%E0%A4%A8%E0%A4%BE%E0%A4%AF%E0%A4%BE%20%E0%A4%97%E0%A4%AF%E0%A4%BE%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20%E0%A4%86%E0%A4%AA%E0%A4%95%E0%A4%BE%20%E0%A4%89%E0%A4%AA%E0%A4%AF%E0%A5%8B%E0%A4%97%E0%A4%95%E0%A4%B0%E0%A5%8D%E0%A4%A4%E0%A4%BE%20%E0%A4%A8%E0%A4%BE%E0%A4%AE%20%3Carg1%3E%20%E0%A4%B9%E0%A5%88%20%E0%A4%94%E0%A4%B0%20%E0%A4%AA%E0%A4%BE%E0%A4%B8%E0%A4%B5%E0%A4%B0%E0%A5%8D%E0%A4%A1%20%3Carg2%3E%20%E0%A4%B9%E0%A5%88%E0%A5%A4%20FEGG`;
						const args = `arg1:${body.username},arg2:${body.password}`;
						const otpRes = await this.authService.sendSMS(
							body.mobile,
							message,
							args,
						);
					}

					let user_id = result?.data?.id;
					if (body.qualification) {
						// get datafrom qulification name get id
						const data = {
							query: `query MyQuery {
								qualification_masters(where: {name: {_eq: "${body.qualification}"}}) {
									id
								}
							}`,
						};

						const hasura_response =
							await this.hasuraServiceFromServices.getData(data);

						const qualification_master_id =
							hasura_response?.data?.qualification_masters?.[0]
								?.id; // Access first element's id

						await this.hasuraService.q(
							`qualifications`,
							{
								user_id,
								qualification_master_id,
							},
							['user_id', 'qualification_master_id'],
						);
					}
					if (role === 'volunteer') {
						const data = {
							query: `query MyQuery {
								roles(where: { slug: {_eq: "volunteer"}}) {
									id
								}
							}`,
						};
						const hasura_response =
							await this.hasuraServiceFromServices.getData(data);
						role_id = hasura_response?.data?.roles?.[0]?.id;

						await this.hasuraService.q(
							`user_roles`,
							{
								user_id,
								status: 'applied',
								role_id: role_id,
								role_slug: 'volunteer',
							},
							['user_id', 'status', 'role_id', 'role_slug'],
						);
					}
					if (user_id && role === 'volunteer') {
						// Set the timezone to Indian Standard Time (Asia/Kolkata)
						const formattedISTTime =
							this.method.getFormattedISTTime();

						// Format the time as per datetime
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
	}
}
