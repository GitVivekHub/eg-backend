import { Injectable } from '@nestjs/common';
import { HasuraService } from 'src/services/hasura/hasura.service';
import { HasuraService as HasuraServiceFromServices } from '../../services/hasura/hasura.service';

@Injectable()
export class GeolocationService {
	constructor(
		private readonly hasuraService: HasuraService,
		private hasuraServiceFromServices: HasuraServiceFromServices,
	) {}

	public async findAll(tableName: string, filters: Object = {}) {
		let query = '';
		if (filters) {
			Object.keys(filters).forEach((e) => {
				if (filters[e] && filters[e] != '') {
					query += `${e}:{_eq:"${filters[e]}"}`;
				}
			});
		}

		let data = {
			query: `
			query SearchAddress {
				${tableName}_aggregate(where:{${query}}) {
					aggregate {
						count
					}
				}

				${tableName}(where:{${query}}) {
					id
					state_name
					state_cd
					district_name
					district_cd
					block_name
					grampanchayat_name
					village_ward_name
					udise_block_code
				}
			}`,
		};

		return await this.hasuraService.postData(data);
	}

	async getStates() {
		let data = {
			query: `
			query MyQuery {
				address_aggregate(distinct_on: [state_name]) {
					aggregate {
						count
					}
				}

				address(distinct_on: [state_name]) {
					state_name
					state_cd
				}
			}`,
		};

		return await this.hasuraService.postData(data);
	}

	async getDistricts(state: string) {
		let data = {
			query: `
			query MyQuery {
				address_aggregate(
					distinct_on: [district_name],
					where: {
						state_name: {_eq: "${state}"}
					}
				) {
					aggregate {
						count
					}
				}

				address(
					distinct_on: [district_name],
					where: {
						state_name: {_eq: "${state}"}
					}
				) {
					district_cd
					district_name
				}
			}`,
		};

		return await this.hasuraService.postData(data);
	}

	async getBlocks(district: string, req: any) {
		let state = req?.query?.state;

		let filter_query;

		if (state) {
			filter_query = `where: {district_name: {_eq: "${district}"}, state_name: {_eq:"${state}"}}`;
		} else {
			filter_query = `where: {
				district_name: {_eq: "${district}"}
			}`;
		}

		let data = {
			query: `
			query MyQuery {
				address_aggregate(
					distinct_on: [block_name],
					${filter_query}
				) {
					aggregate {
						count
					}
				}

				address(
					distinct_on: [block_name],
					${filter_query}
				) {
					block_name
				}
			}`,
		};

		return await this.hasuraService.postData(data);
	}

	async getBlocksFromDistricts(body: any, resp: any) {
		let data = {
			query: `query MyQuery {
				address(distinct_on: [block_name], where: {district_name: {_in: ${JSON.stringify(
					body?.districts,
				)}}}) {
				  block_name
				  district_name
				}
			  }`,
		};

		const response = await this.hasuraServiceFromServices.getData(data);

		if (response?.data?.address && response?.data?.address?.length > 0) {
			return resp.status(200).json({
				success: true,
				message: 'Blocks found success!',
				data: response?.data?.address,
			});
		} else {
			return resp.status(200).send({
				success: false,
				status: 'Not Found',
				message: 'Blocks Not Found',
				data: {},
			});
		}
	}

	async getVillages(block: string, req: any) {
		let { state, district, grampanchayat } = req.query;
		let filter_query;

		if (grampanchayat == 'null') {
			filter_query = `where: {district_name: {_eq: "${district}"}, block_name: {_eq:"${block}"}, state_name: {_eq:"${state}"}}`;
		} else {
			filter_query = `where: {district_name: {_eq: "${district}"}, block_name: {_eq:"${block}"}, grampanchayat_name: {_eq:"${grampanchayat}"}, state_name: {_eq:"${state}"}}`;
		}
		let data = {
			query: `query MyQuery {
				address_aggregate(distinct_on: [village_ward_name],${filter_query}) {
				  aggregate {
					count
				  }
				}
				address(distinct_on: [village_ward_name],${filter_query}) {
				  village_ward_name
				}
			  }
			  `,
		};

		return await this.hasuraService.postData(data);
	}

	async getGramPanchayat(req: any) {
		let { state, district, block } = req.query;

		let data = {
			query: `query MyQuery {
				address_aggregate(distinct_on: [grampanchayat_name], where: {district_name: {_eq:"${district}"}, block_name: {_eq: "${block}"}, state_name: {_eq:"${state}"}}) {
				  aggregate {
					count
				  }
				}
				address(distinct_on: [grampanchayat_name], where: {district_name: {_eq:"${district}"}, block_name: {_eq: "${block}"}, state_name: {_eq:"${state}"}}) {
				  grampanchayat_name
				}
			  }
			  `,
		};

		return await this.hasuraService.postData(data);
	}

	//Address Master data Add
	async add(body: any, request: any, response: any) {
		const user_role = request?.mw_roles;
		// Validate user role
		if (!user_role.includes('program_owner')) {
			return response.status(403).json({
				success: false,
				message: 'Permission denied. Only PO can Add the Address.',
			});
		}

		const {
			state_name,
			state_cd,
			district_name,
			district_cd,
			udise_block_code,
			block_name,
			grampanchayat_cd,
			grampanchayat_name,
			vill_ward_cd,
			village_ward_name,
			school_name,
			udise_sch_code,
			sch_category_id,
			sch_mgmt_id,
			open_school_type,
			nodal_code,
		} = body;
		const missingFields = [
			'state_name',
			'state_cd',
			'district_name',
			'district_cd',
			'udise_block_code',
			'block_name',
			'grampanchayat_cd',
			'grampanchayat_name',
			'vill_ward_cd',
			'village_ward_name',
			'school_name',
			'udise_sch_code',
			'sch_category_id',
			'sch_mgmt_id',
			'open_school_type',
			'nodal_code',
		].filter((field) => !body[field] && body[field] != '');

		if (missingFields.length > 0) {
			return response.status(422).send({
				success: false,
				key: missingFields?.[0],
				message: `Required fields are missing in the payload. ${missingFields.join(
					',',
				)}`,
				data: {},
			});
		}
		const AddressDetails = {
			state_name: body?.state_name,
			state_cd: body?.state_cd,
			district_name: body?.district_name,
			district_cd: body?.district_cd,
			udise_block_code: body?.udise_block_code,
			block_name: body?.block_name,
			grampanchayat_cd: body?.grampanchayat_cd,
			grampanchayat_name: body?.grampanchayat_name,
			vill_ward_cd: body?.vill_ward_cd,
			village_ward_name: body?.village_ward_name,
			school_name: body?.school_name,
			udise_sch_code: body?.udise_sch_code,
			sch_category_id: body?.sch_category_id,
			sch_mgmt_id: body?.sch_mgmt_id,
			open_school_type: body?.open_school_type,
			nodal_code: body?.nodal_code,
		};

		const newAddressadd = await this.hasuraService.q(
			'address',
			AddressDetails,
			[
				'state_name',
				'state_cd',
				'district_name',
				'district_cd',
				'udise_block_code',
				'block_name',
				'grampanchayat_cd',
				'grampanchayat_name',
				'vill_ward_cd',
				'village_ward_name',
				'school_name',
				'udise_sch_code',
				'sch_category_id',
				'sch_mgmt_id',
				'open_school_type',
				'nodal_code',
			],
		);

		if (!newAddressadd || !newAddressadd?.address.id) {
			throw new Error('Failed to Add Address.');
		}
		const address = newAddressadd?.address;

		// Return success response
		response.status(200).json({
			success: true,
			message: 'Address Added successfully.',
			data: address,
		});
	}

	public async getAddressList(body: any, request: any, response: any) {
		const user_role = request?.mw_roles;
		// Validate user role
		if (!user_role.includes('program_owner')) {
			return response.status(403).json({
				success: false,
				message: 'Permission denied. Only PO can Add the Address.',
			});
		}
		const onlyfilter = [
			'id',
			'state_name',
			'state_cd',
			'district_name',
			'district_cd',
			'udise_block_code',
			'block_name',
			'grampanchayat_cd',
			'grampanchayat_name',
			'vill_ward_cd',
			'village_ward_name',
			'school_name',
			'udise_sch_code',
			'sch_category_id',
			'sch_mgmt_id',
			'open_school_type',
			'nodal_code',
		];
		body.filters = {
			...(body.filters || {}),
		};

		const hasura_response = await this.hasuraServiceFromServices.getAll(
			'address',
			[...onlyfilter],
			{ ...body, onlyfilter: [...onlyfilter, 'core'] },
		);

		// Return success response
		response.status(200).json({
			success: true,
			message: 'List Of Address Fetch Successfully.',
			...(hasura_response || {}),
		});
	}

	public async getAddressDetails(req: any, resp: any, id: any) {
		try {
			const user_role = req?.mw_roles;
			if (!user_role.includes('program_owner')) {
				return resp.status(403).json({
					success: false,
					message: 'Permission denied. Only PO can See.',
				});
			}
			let data = {
				query: `query MyQuery {
          address(where: {id:{_eq:${id}}
          }) {
            id
						state_name,
						state_cd,
						district_name,
						district_cd,
						udise_block_code,
						block_name,
						grampanchayat_cd,
						grampanchayat_name,
						vill_ward_cd,
						village_ward_name,
						school_name,
						udise_sch_code,
						sch_category_id,
						sch_mgmt_id,
						open_school_type,
						nodal_code,
          }
        }
			`,
			};

			const response = await this.hasuraServiceFromServices.getData(data);

			const addr = response?.data?.address || [];

			if (addr.length == 0) {
				return resp.status(422).send({
					success: false,
					message: 'Address Details Not found!',
					data: addr,
				});
			} else {
				return resp.status(200).send({
					success: true,
					message: 'Address Details found successfully!',
					data: addr?.[0],
				});
			}
		} catch (error) {
			// Log error and return a generic error response
			console.error('Error fetching Address:', error.message);
			return resp.status(422).send({
				success: false,
				message: 'An error occurred while fetching Address',
				data: {},
			});
		}
	}

	async addressUpdate(id: any, body: any, request: any, resp: any) {
		try {
			const user_role = request?.mw_roles;
			// Check if id:organisation is a valid ID
			if (!id || isNaN(id) || id === 'string' || id <= 0) {
				return resp.status(422).send({
					success: false,
					message: 'Invalid ID for DoId. Please provide a valid ID.',
					data: {},
				});
			}
			if (!user_role.includes('program_owner')) {
				return resp.status(403).json({
					success: false,
					message: 'Permission denied. Only PO can Edit.',
				});
			}
			const AddressFields = [
				'state_name',
				'state_cd',
				'district_name',
				'district_cd',
				'udise_block_code',
				'block_name',
				'grampanchayat_cd',
				'grampanchayat_name',
				'vill_ward_cd',
				'village_ward_name',
				'school_name',
				'udise_sch_code',
				'sch_category_id',
				'sch_mgmt_id',
				'open_school_type',
				'nodal_code',
			];

			const addressResponse = await this.hasuraService.q(
				'address',
				{ ...body, id },
				AddressFields,
				true,
				[
					'id',
					'state_name',
					'state_cd',
					'district_name',
					'district_cd',
					'udise_block_code',
					'block_name',
					'grampanchayat_cd',
					'grampanchayat_name',
					'vill_ward_cd',
					'village_ward_name',
					'school_name',
					'udise_sch_code',
					'sch_category_id',
					'sch_mgmt_id',
					'open_school_type',
					'nodal_code',
				],
			);

			return resp.status(200).json({
				success: true,
				message: 'Updated successfully!',
				data: addressResponse,
			});
		} catch (error) {
			return resp.status(500).json({
				success: false,
				message: "Couldn't update the Address.",
				data: {},
			});
		}
	}

	public async getStateLists(resp: any) {
		try {
			const states_of_india = [
				'ANDHRA PRADESH',
				'ARUNACHAL PRADESH',
				'ASSAM',
				'BIHAR',
				'CHHATTISGARH',
				'GOA',
				'GUJARAT',
				'HARYANA',
				'HIMACHAL PRADESH',
				'JHARKHAND',
				'KARNATAKA',
				'KERALA',
				'MADHYA PRADESH',
				'MAHARASHTRA',
				'MANIPUR',
				'MEGHALAYA',
				'MIZORAM',
				'NAGALAND',
				'ODISHA',
				'PUNJAB',
				'RAJASTHAN',
				'SIKKIM',
				'TAMIL NADU',
				'TELANGANA',
				'TRIPURA',
				'UTTAR PRADESH',
				'UTTARAKHAND',
				'WEST BENGAL',
			];
			// Return the list of states as a response
			return resp.status(200).send({
				success: true,
				message: 'List of Indian states',
				data: states_of_india,
			});
		} catch (error) {
			// Log error and return a generic error response
			console.error('Error fetching List:', error);
			return resp.status(422).send({
				success: false,
				message: 'An error occurred while fetching List data',
				data: {},
			});
		}
	}
}
