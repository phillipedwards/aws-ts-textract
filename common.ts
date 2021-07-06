import * as aws from "@pulumi/aws";
import { ManagedPolicy, RolePolicyAttachment } from "@pulumi/aws/iam";

/*
    Define the single role that will be used for all lambda functions
    NOTE: this is an example of over permissioning lambda functions, which should be decomposed, into more granular allocations for similar use case functions.
*/ 
export const lambaRole = (): aws.iam.Role => {
    const lambdaRole = new aws.iam.Role("lambdaRole", {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" }),
    });

    new aws.iam.RolePolicy("lambdaRolePolicy", {
        role: lambdaRole.id,
        policy: {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                Resource: "arn:aws:logs:*:*:*",
            },
            {
                Effect: "Allow",
                Action: ["s3:*Object"],
                Resource: "*"
            }]
        },
    });

    new RolePolicyAttachment("baseLambdaRole", {
        role: lambdaRole,
        policyArn: ManagedPolicy.AWSLambdaBasicExecutionRole
    });

    new RolePolicyAttachment("textractLambdaRole", {
        role: lambdaRole,
        policyArn: "arn:aws:iam::aws:policy/AmazonTextractFullAccess"
    });

    new RolePolicyAttachment("stepFunctionsLambda", {
        role: lambdaRole,
        policyArn: ManagedPolicy.AWSStepFunctionsFullAccess
    });

    return lambdaRole;
}

// object to define the inputs and output of the State Machine
export interface ObjectEvent {
    id: string,
    bucket: string,
    key: string,
    textractStatus?: string,
    jobId?: string
}