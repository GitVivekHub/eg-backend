import { Injectable } from '@nestjs/common';
import { HasuraService } from '../hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../services/hasura/hasura.service';
import { UploadFileService } from 'src/upload-file/upload-file.service';
@Injectable()
export class VolunteerService {
	constructor(
		private hasuraService: HasuraService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
		private uploadFileService: UploadFileService,
	) {}

	public async getvolunteerList(body: any, request: any, response: any) {
		const user_role = request?.mw_roles;
		//Validate user role
		if (!user_role.includes('volunteer_admin')) {
			return response.status(403).json({
				success: false,
				message: 'Permission denied. Only Volunteer Admin can See.',
			});
		}
		const onlyfilter = [
			'id',
			'first_name',
			'middle_name',
			'last_name',
			'mobile',
			'email_id',
			'dob',
			'state',
			'gender',
			'pincode',
		];
		body.filters = {
			...(body.filter || {}),
			core: `user_roles:{role_slug:{_eq:"volunteer"}}`,
		};

		const hasura_response = await this.hasuraServiceFromServices.getAll(
			'users',
			[
				'id',
				'first_name',
				'middle_name',
				'last_name',
				'mobile',
				'email_id',
				'dob',
				'state',
				'gender',
				'pincode',
				' qualifications {id qualification_master_id qualification_master {name } }',
				'user_roles{status role_slug user_id id}',
			],
			{ ...body, onlyfilter: [...onlyfilter, 'core'] },
		);
		// Return success response
		response.status(200).json({
			success: true,
			message: 'List Of Volunteer Fetch Successfully',
			...(hasura_response || {}),
		});
	}

	async update(id: any, body: any, request: any, resp: any) {
		try {
			const user_role = request?.mw_roles;
			//Validate user role
			if (!user_role.includes('volunteer_admin')) {
				return resp.status(403).json({
					success: false,
					message: 'Permission denied. Only Volunteer Admin can See.',
				});
			}
			// Check if id:volunteer and user role id is a valid ID
			if (!id || isNaN(id) || id === 'string' || id <= 0) {
				return resp.status(404).send({
					success: false,
					message: 'Invalid volunteer ID. Please provide a valid ID.',
					data: {},
				});
			}

			const usersFields = [
				'first_name',
				'last_name',
				'gender',
				'mobile',
				'email_id',
				'dob',
				'state',
				'pincode',
			];
			const userRoleUpdateFields = ['id', 'status'];
			let userResponse = {};
			let userRoleResponse = {};
			if (body?.user_roles) {
				const userRoleId = body.user_roles.id;
				if (
					userRoleId &&
					!isNaN(Number(userRoleId)) &&
					Number(userRoleId) > 0
				) {
					userRoleResponse = await this.hasuraService.q(
						'user_roles',
						{ ...body.user_roles, id: userRoleId },
						userRoleUpdateFields,
						true,
						['id', 'status'],
					);
				} else {
					return resp.status(400).json({
						success: false,
						message:
							'Invalid user role ID. Please provide a valid ID.',
					});
				}
			}

			if (body?.users) {
				userResponse = await this.hasuraService.q(
					'users',
					{ ...body.users, id },
					usersFields,
					true,
					[
						'id',
						'first_name',
						'last_name',
						'gender',
						'mobile',
						'email_id',
						'dob',
						'state',
						'pincode',
					],
				);
			}

			return resp.status(200).json({
				success: true,
				message: 'Updated successfully!',
				data: { userResponse, userRoleResponse },
			});
		} catch (error) {
			return resp.status(500).json({
				success: false,
				message: "Couldn't update the Volunteer.",
				data: {},
			});
		}
	}

	public async getVolunteerDetails(req: any, resp: any, id: any) {
		//Validate user role
		const user_role = req?.mw_roles;
		if (!user_role.includes('volunteer_admin')) {
			return resp.status(403).json({
				success: false,
				message: 'Permission denied. Only Volunteer Admin can See.',
			});
		}
		const user_id = id;
		try {
			const data = {
				query: `query MyQuery {
          users(where: {id: {_eq: ${user_id}},user_roles:{role_slug:{_eq:"volunteer"}}}) {
            id
            first_name
            middle_name
            last_name
            mobile
            gender
            dob
            state
						username
						profile_photo_1: documents(where: {document_sub_type: {_eq: "profile_photo_1"}}) {
							id
			name
			doument_type
			document_sub_type
			path
		  
						}
            qualifications {
              id
              qualification_master_id
              qualification_master {
                name
              }
            }
            user_roles {
              id
              user_id
              status
              role_slug
            }
          }
        }
        
			`,
			};

			const response = await this.hasuraServiceFromServices.getData(data);

			let volunteer = response?.data?.users || [];

			volunteer = await Promise.all(
				volunteer?.map(async (obj) => {
					let mappedData = {
						...obj,
						['profile_photo_1']:
							obj?.['profile_photo_1']?.[0] || {},
					};
					if (mappedData?.profile_photo_1?.id) {
						const { success, data: fileData } =
							await this.uploadFileService.getDocumentById(
								mappedData?.profile_photo_1?.id,
							);
						if (success && fileData?.fileUrl) {
							mappedData.profile_photo_1.fileUrl =
								fileData.fileUrl;
						}
					}
					return mappedData;
				}),
			);
			if (volunteer.length === 0) {
				return resp.status(404).send({
					success: false,
					message: 'volunteer Details Not found!',
					data: volunteer,
				});
			}
			return resp.status(200).send({
				success: true,
				message: 'volunteer Details found successfully!',
				data: volunteer?.[0],
			});
		} catch (error) {
			console.error('Error fetching volunteer:', error);
			return resp.status(500).send({
				success: false,
				message: 'An error occurred while fetching volunteer',
				data: {},
			});
		}
	}

	//update self data
	async updatevolunteer(body: any, request: any, resp: any) {
		try {
			const user_role = request?.mw_roles;
			//Validate user role
			if (!user_role.includes('volunteer')) {
				return resp.status(403).json({
					success: false,
					message: 'Permission denied. Only Volunteer can Update.',
				});
			}

			const id = request.mw_userid;
			// Check if id:volunteer and user role id is a valid ID
			if (!id || isNaN(id) || id === 'string' || id <= 0) {
				return resp.status(404).send({
					success: false,
					message: 'Invalid volunteer ID. Please provide a valid ID.',
					data: {},
				});
			}

			const usersFields = [
				'first_name',
				'middle_name',
				'last_name',
				'gender',
				'mobile',
				'email_id',
				'dob',
				'state',
				'pincode',
			];

			let userResponse = {};
			let qualificationResponse = {};
			if (body?.qualification) {
				// get datafrom qulification name get id
				const data = {
					query: `query MyQuery {
						qualification_masters(where: {name: {_eq: "${body?.qualification?.qualification_name}"}}) {
							id
						}
					}`,
				};

				const hasura_response =
					await this.hasuraServiceFromServices.getData(data);

				const qualification_master_id =
					hasura_response?.data?.qualification_masters?.[0]?.id; // Access first element's id

				if (!qualification_master_id) {
					return resp.status(404).json({
						success: false,
						message: 'Qualification not found.',
					});
				}
				const qualificationId = body.qualification.id;
				if (qualificationId) {
					qualificationResponse = await this.hasuraService.q(
						'qualifications',
						{
							...body.qualification,
							id: qualificationId,
							qualification_master_id,
						},
						['id', 'qualification_master_id'],
						true,
						['id', 'qualification_master_id'],
					);
				} else {
					return resp.status(400).json({
						success: false,
						message: 'Invalid qualification ID.',
					});
				}
			}

			if (body?.users) {
				userResponse = await this.hasuraService.q(
					'users',
					{ ...body.users, id },
					usersFields,
					true,
					[
						'id',
						'first_name',
						'middle_name',
						'last_name',
						'gender',
						'mobile',
						'email_id',
						'dob',
						'state',
						'pincode',
					],
				);
			}

			return resp.status(200).json({
				success: true,
				message: 'Updated successfully!',
				data: { userResponse, qualificationResponse },
			});
		} catch (error) {
			return resp.status(500).json({
				success: false,
				message: "Couldn't update the Volunteer.",
				data: {},
			});
		}
	}
}
