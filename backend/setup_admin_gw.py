import boto3
import json
import sys

region = 'ap-southeast-1'
api_id = 'yg7y0xkb50'
account_id = '228304098112'

client = boto3.client('apigatewayv2', region_name=region)
lambda_client = boto3.client('lambda', region_name=region)

admin_funcs = {
    "admin-analysis": {"method": "GET", "path": "/admin/analysis/{proxy+}"},
    "admin-users": {"method": "GET", "path": "/admin/users"},
    "admin-versions": {"method": "GET", "path": "/admin/versions"},
    "admin-vouchers": {"method": "GET", "path": "/admin/vouchers"},
    "admin-logs": {"method": "GET", "path": "/admin/logs"},
    "admin-admins": {"method": "GET", "path": "/admin/admins"},
    "admin-moderation": {"method": "GET", "path": "/admin/moderation"},
    "admin-push-all": {"method": "POST", "path": "/admin/push-all"}
}

for base_name, cfg in admin_funcs.items():
    func_name = f"Mahjongclub-App-api-{base_name}_Local"
    func_arn = f"arn:aws:lambda:{region}:{account_id}:function:{func_name}"
    
    print(f"Processing {base_name} -> {func_arn}", file=sys.stderr)
    
    try:
        # 1. Create integration
        integration = client.create_integration(
            ApiId=api_id,
            IntegrationType='AWS_PROXY',
            IntegrationUri=func_arn,
            PayloadFormatVersion='2.0'
        )
        integration_id = integration['IntegrationId']
        print(f"  Created integration: {integration_id}", file=sys.stderr)
        
        # 2. Create route
        route_key = f"{cfg['method']} {cfg['path']}"
        route = client.create_route(
            ApiId=api_id,
            RouteKey=route_key,
            Target=f"integrations/{integration_id}"
        )
        print(f"  Created route: {route_key}", file=sys.stderr)

        # 3. Add Lambda permission
        statement_id = f"apigw-{api_id}-{base_name}"
        try:
            lambda_client.add_permission(
                FunctionName=func_name,
                StatementId=statement_id,
                Action='lambda:InvokeFunction',
                Principal='apigateway.amazonaws.com',
                SourceArn=f"arn:aws:execute-api:{region}:{account_id}:{api_id}/*"
            )
            print(f"  Added Lambda permission", file=sys.stderr)
        except Exception as pe:
            if 'already exists' in str(pe):
                print(f"  Permission already exists", file=sys.stderr)
            else:
                print(f"  Error adding permission: {str(pe)}", file=sys.stderr)
    except Exception as e:
        print(f"  Error processing {base_name}: {str(e)}", file=sys.stderr)

print("Done!", file=sys.stderr)
