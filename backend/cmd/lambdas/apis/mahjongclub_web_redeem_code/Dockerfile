FROM public.ecr.aws/lambda/provided:al2023

COPY bootstrap /var/task/bootstrap
RUN chmod +x /var/task/bootstrap

CMD [ "handler" ]
