# n8n para ODB, con un solo agregado: los volúmenes de Railway se montan como
# root y la imagen oficial corre como usuario node, así que sin esto n8n muere
# al arrancar con EACCES sobre /home/node/.n8n. El arranque corrige la
# propiedad del disco y recién ahí baja al usuario node, como corresponde.
FROM n8nio/n8n:latest
USER root
COPY infra/n8n/inicio.sh /inicio.sh
RUN chmod +x /inicio.sh
ENTRYPOINT ["/inicio.sh"]
