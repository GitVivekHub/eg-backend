import {
	MiddlewareConsumer,
	Module,
	NestModule,
	RequestMethod,
} from '@nestjs/common';
import { VolunteerService } from './volunteer.service';
import { VolunteerController } from './volunteer.controller';
import { HasuraModule as HasuraModuleFromServices } from '../services/hasura/hasura.module';
import { HasuraModule } from '../hasura/hasura.module';
import { CohortMiddleware } from 'src/common/middlewares/cohort.middleware';
import { Method } from 'src/common/method/method';
import { UploadFileModule } from 'src/upload-file/upload-file.module';
@Module({
	imports: [HasuraModuleFromServices, HasuraModule, UploadFileModule],
	controllers: [VolunteerController],
	providers: [VolunteerService, Method],
})
export class VolunteerModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer
			.apply(CohortMiddleware)
			.exclude('/volunteer/list', '/volunteer/:id')
			.forRoutes(VolunteerController);
	}
}
